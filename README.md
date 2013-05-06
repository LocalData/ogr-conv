ogr-conv
========

A webservice for converting GeoJSON data to ESRI Shapefile format.
 
Uses GDAL's ogr2ogr tool to perform the converstion. Depends on the [nodejs-ogr](https://github.com/LocalData/heroku-buildpack-nodejs-ogr) Heroku buildpack.

##API

`POST /geojson2shp`
Post a GeoJSON file and receive a ZIP archive of the ESRI Shapefile `output.shp` and the supporting files.

`POST /geojson2shp/{basename}`
Post a GeoJSON file and receive a ZIP archive of the ESRI Shapefile and the supporting files, named with the specified base name.