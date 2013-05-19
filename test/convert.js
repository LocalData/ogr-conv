/*jslint node: true */
/*globals suite, test, setup, suiteSetup, suiteTeardown, done, teardown */
'use strict';

var server = require('../lib/index.js');
var should = require('should');
var uuid = require('node-uuid');
var qfs = require('q-io/fs');

var TMPDIR = '/tmp';

suite('Convert', function () {

  function makeGeoJSON() {
    function makeFeature(parcelId) {
      var offsetX = Math.random() * 0.001 - 0.0005;
      var offsetY = Math.random() * 0.001 - 0.0005;

      return {
        type: 'Feature',
        geometry: {
          type: 'MultiPolygon',
          coordinates: [ [ [
            [-122.43469523018862 + offsetX, 37.771087088400655 + offsetY],
            [-122.43477071284453 + offsetX, 37.77146083403105 + offsetY],
            [-122.4346853083731 + offsetX, 37.77147170307505 + offsetY],
            [-122.43460982859321 + offsetX, 37.771097964560134 + offsetY],
            [-122.43463544873167 + offsetX, 37.77109470163426 + offsetY],
            [-122.43469523018862 + offsetX, 37.771087088400655 + offsetY]
          ] ] ]
        },
        properties: {
          source: {
            type: 'mobile',
            collector: 'Name'
          },
          geo_info: {
            centroid: [-122.43469027023522, 37.77127939798119],
            humanReadableName: '763 HAIGHT ST',
            parcel_id: parcelId
          },
          parcel_id: parcelId,
          object_id: parcelId,
          responses: {
            'use-count': '1',
            collector: 'Some Name',
            site: 'parking-lot',
            'condition-1': 'demolish'
          }
        }
      };
    }
    var featureCollection = {
      type: 'FeatureCollection',
      features: []
    };
    var parcelBase = 123456;
    var i;
    for (i = 0; i < 20; i += 1) {
      featureCollection.features.push(makeFeature((parcelBase + i).toString()));
    }
    return featureCollection;
  }

  setup(function (done) {
    var id = uuid.v1();
    this.geoJSONFile = TMPDIR + '/' + id + '.json';
    var outdir = TMPDIR + '/' + id;

    var geoJSON = makeGeoJSON();

    // Save the GeoJSON input to a temporary file.
    qfs.write(this.geoJSONFile, JSON.stringify(geoJSON))
    .then(done);
  });

  test('shapefile', function (done) {
    server.convert(this.geoJSONFile)
    .then(function (stream) {
      var count = 0;
      stream
      .on('data', function (data) {
        count += data.length;
      })
      .on('error', done)
      .on('end', function () {
        count.should.be.above(2000);
        done();
      });
    });
  });

});

