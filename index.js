/*jslint node: true */
'use strict';

var express = require('express');
var http = require('http');
var exec = require('child_process').exec;

var app = express();
var server = http.createServer(app);

app.use(express.logger());

app.get('/ogr2ogr', function (req, res) {
  exec('cat *.js bad_file | wc -l',
    function (error, stdout, stderr) {
      if (error) {
        res.send(500);
        console.log(error);
        return;
      }
      res.send('stdout: ' + stdout + '\n' + 'stderr: ' + stderr);
  });
});

server.listen(process.env.PORT, function (error) {
  if (error) {
    console.log(error);
    return;
  }
  console.log('Listening on ' + process.env.PORT);
});
