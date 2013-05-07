/*jslint node: true */
'use strict';

var http = require('http');
var fs = require('fs');
var childProcess = require('child_process');

var express = require('express');
var archiver = require('archiver');
var uuid = require('node-uuid');
var Q = require('q');
var qfs = require('q-io/fs');

// If we write a ZIP file larger than this, issue a warning.
var LARGE_WARN = 20*1024*1024;

var app = express();
var server = http.createServer(app);

app.use(express.logger());

// Specify the execution environment: 'heroku' or 'local'
var environment = process.env.ENVIRONMENT;

var TMPDIR;
var OGRCMD;

if (environment === 'heroku') {
  TMPDIR = 'tmp';
  OGRCMD = 'LD_LIBRARY_PATH=/app/vendor/gdal/lib GDAL_DATA=/app/vendor/gdal/share/gdal /app/vendor/gdal/bin/ogr2ogr -f "ESRI Shapefile" ';
} else if (environment === 'local') {
  TMPDIR = '/tmp';
  OGRCMD = 'ogr2ogr -f "ESRI Shapefile" ';
} else {
  throw {
    name: 'InvalidEnvironmentError',
    message: 'You must specify a valid value for the ENVIRONMENT'
  };
}

function bufferPostData(req, res, next) {
  var buf = '';
  req.on('data', function (chunk) {
    buf += chunk;
  });
  req.on('end', function () {
    req.body = buf;
    next();
  });
}

// Wrap childProcess.exec with promise functionality
function exec(cmd, options) {
  var deferred = Q.defer();
  childProcess.exec(cmd, options, function (error, stdout, stderr) {
    if (error) {
      deferred.reject(error);
      return;
    }
    deferred.resolve({
      stdout: stdout,
      stderr: stderr
    });
  });
  return deferred.promise;
}

// Just for testing out that we can execute the ogr2ogr command.
app.get('/ogr2ogr', function (req, res) {
  exec('LD_LIBRARY_PATH=/app/vendor/gdal/lib /app/vendor/gdal/bin/ogr2ogr --help',
    function (error, stdout, stderr) {
      res.send('stdout: ' + stdout + '\n' + 'stderr: ' + stderr);
      if (error) {
        res.send(500);
        console.log(error);
      }
  });
});

/**
 * @return {Promise} A promise for a Readable Stream for the zipfile.
 */
function convert(geoJSONFile) {
  var id = uuid.v1();
  var outdir = TMPDIR + '/' + id;
  var outname = 'output';
  var zip;

  // Make the temporary directory
  return qfs.makeDirectory(outdir)
  .then(function () {
    // Run the ogr2ogr command
    return exec(OGRCMD + outdir + '/' + outname + '.shp ' + geoJSONFile);
  })
  .then(function (outputs) {
    // Gather the names of the files created by ogr2ogr.

    console.log(outputs.stdout);
    console.log(outputs.stderr);

    // Return a promise for the file names
    return qfs.list(outdir);
  })
  .then(function (files) {
    zip = archiver('zip');

    zip.on('error', function (error) {
      console.log(error);
      throw error;
    });

    // Add files to the zip stream.
    files.forEach(function (name) {
      zip.append(fs.createReadStream(outdir + '/' + name), { name : name });
    });

    // Finalize the zip stream.
    Q.ninvoke(zip, 'finalize')
    .then(function (count) {
      if (count > LARGE_WARN) {
        console.log('WARNING: Large file');
      }
      console.log('Wrote ' + count + ' bytes to the ZIP archive.');
      // Remove temporary directory
      return qfs.removeTree(outdir);
    })
    .then(function () {
      // Remove the temporary GeoJSON file
      return qfs.remove(geoJSONFile);
    })
    .fail(function (error) {
      console.log(error);
      throw error;
    });

    // Return a promise for the ZIP stream.
    return zip;
  });
}

function postGeoJSON2Shapefile(req, res) {
  var id = uuid.v1();
  var geoJSONFile = TMPDIR + '/' + id + '.json';
  var outdir = TMPDIR + '/' + id;
  var outname = 'output';
  var zip;

  if (req.params.basename !== undefined) {
    outname = req.params.basename;
  }

  // Save the GeoJSON input to a temporary file.
  qfs.write(geoJSONFile, req.body)
  .then(function () {
    return convert(geoJSONFile);
  })
  .then(function (zip) {
    res.set('Content-Type', 'application/zip');
    zip.pipe(res);
  })
  .fail(function (error) {
    console.log(error);
    res.send(500);
    throw error;
  });
}

function handleControlInversion(req, res) {
  var url = req.body.url;

  // Determine S3 path
  // XXX
  // Send S3 path to client
  // XXX
  // Fetch GeoJSON data
  // XXX
  // Convert to shapefile
  // XXX
  // Store on S3
  // XXX
 res.send(501);
}

app.post('/geojson2shp', bufferPostData, postGeoJSON2Shapefile);
app.post('/geojson2shp/:basename', bufferPostData, postGeoJSON2Shapefile);
app.post('/inversion/geojson2shp/:basename', express.json(), handleControlInversion);

server.listen(process.env.PORT, function (error) {
  if (error) {
    console.log(error);
    return;
  }
  console.log('Listening on ' + process.env.PORT);
});

