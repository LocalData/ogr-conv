/*jslint node: true */
'use strict';

var http = require('http');
var fs = require('fs');
var childProcess = require('child_process');

var express = require('express');
var zipstream = require('zipstream');
var uuid = require('node-uuid');
var Q = require('q');
var qfs = require('q-io/fs');

var app = express();
var server = http.createServer(app);

app.use(express.logger());

var TMPDIR = 'tmp';

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
    // Make the temporary directory
    return qfs.makeDirectory(outdir);
  })
  .then(function () {
    // Run the ogr2ogr command
    return exec('LD_LIBRARY_PATH=/app/vendor/gdal/lib GDAL_DATA=/app/vendor/gdal/share/gdal /app/vendor/gdal/bin/ogr2ogr -f "ESRI Shapefile" ' + outdir + '/' + outname + '.shp ' + geoJSONFile);
  })
  .then(function (outputs) {
    console.log(outputs.stdout);
    console.log(outputs.stderr);

    res.set('Content-Type', 'application/zip');

    // Pipe the zip file to the response.
    zip = zipstream.createZip();
    zip.pipe(res);

    // Return a promise for the file names
    return qfs.list(outdir);
  })
  .then(function (files) {
    // Add files to the zip stream.

    // Make functions that each add a file to the zip stream and return a promise.
    var adders = files.map(function (name) {
      return function add() {
        var deferred = Q.defer();
        zip.addFile(fs.createReadStream(outdir + '/' + name), { name : name }, function () {
          deferred.resolve();
        });
        return deferred.promise;
      }
    });

    // Sequence the additions of files to the zip stream.
    return adders.reduce(function (promise, f) {
      return promise.then(f);
    }, Q.resolve());
  })
  .then(function () {
    var deferred = Q.defer();
    // Finalize the zip stream
    zip.finalize(function (count) {
      deferred.resolve(count);
    });
    return deferred.promise;
  })
  .then(function (count) {
    console.log(count + ' total bytes written');
    // End the response
    res.end();

    // Remove temporary directory
    return qfs.removeTree(outdir);
  })
  .then(function () {
    // Remove the temporary GeoJSON file
    return qfs.remove(geoJSONFile);
  })
  .fail(function (error) {
    console.log(error);
    res.send(500);
  });
}

app.post('/geojson2shp', bufferPostData, postGeoJSON2Shapefile);
app.post('/geojson2shp/:basename', bufferPostData, postGeoJSON2Shapefile);

server.listen(process.env.PORT, function (error) {
  if (error) {
    console.log(error);
    return;
  }
  console.log('Listening on ' + process.env.PORT);
});

