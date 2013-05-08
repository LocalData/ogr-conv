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
var knox = require('knox');
var request = require('request');

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

// S3 upload configuration
var bucket = process.env.S3_BUCKET;
var uploadDir = process.env.S3_UPLOAD_DIR;
var uploadPrefix = 'http://' + bucket + '.s3.amazonaws.com/';

var client = knox.createClient({
  key: process.env.S3_KEY,
  secret: process.env.S3_SECRET,
  bucket: bucket
});


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
    })
    .done();

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
  })
  .done();
}

// Instead of receiving GeoJSON to convert, we go and fetch it. We tell the
// client where we will stash the created Shapefile archive.
function handleControlInversion(req, res) {
  console.log(req.body); // XXX
  var url = req.body.url;
  var id = uuid.v1();

  var geoJSONFile = TMPDIR + '/' + id + '.json';
  var outdir = TMPDIR + '/' + id;
  var outname = 'output';
  var zipFile = TMPDIR + '/' + id + '_' + outname + '.zip';

  if (req.params.basename !== undefined) {
    outname = req.params.basename;
  }


  // Determine S3 path
  var s3Object = uploadDir + '/' + id + '/' + outname + '.zip';
  var s3Path = uploadPrefix + s3Object;

  // Send S3 path to client
  // We send a 202 Accepted because we have not yet created the file, but we
  // have graciously agreed to try.
  res.send(202, {
    url: s3Path
  });

  // Fetch GeoJSON data and save to a temporary file.
  var geoJSONFileStream = request(url).pipe(fs.createWriteStream(geoJSONFile));

  Q.ninvoke(geoJSONFileStream, 'on', 'finish')
  .then(function () {
    // Convert to shapefile
    // This gives us a promise for the zip stream.
    return convert(geoJSONFile);
  })
  .then(function (zip) {
    // Write the ZIP file to disk temporarily, since we need the content length
    // for S3.
    var zipFileStream = zip.pipe(fs.createWriteStream(zipFile));
    return Q.ninvoke(zipFileStream, 'on', 'finish');
  })
  .then(function () {
    // Store on S3
    return Q.ninvoke(client, 'putFile', zipFile, s3Object);
  })
  .then(function () {
    console.log('Saved ZIP file to ' + s3Path);

    // Clean up the temporary ZIP file.
    return qfs.remove(zipFile);
  })
  .fail(function (error) {
    console.log(error);
    throw error;
  })
  .done();
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

