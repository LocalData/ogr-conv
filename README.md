ogr-conv
========

A webservice for converting GeoJSON data to ESRI Shapefile format.
 
Uses GDAL's ogr2ogr tool to perform the converstion. Depends on the [nodejs-ogr](https://github.com/LocalData/heroku-buildpack-nodejs-ogr) Heroku buildpack.

## API

`POST /inversion/geojson2shp/BASENAME`  
Post JSON data in the following form

```
{
  "url": "http://localdata-api.example.com/api/surveys/SURVEYID/responses.geojson"
}        
```

The conversion service will return a status 202 with a JSON response containing a `url` property indicating where the ZIP'd shapefile will be stored. The service will then fetch the data in chunks, using the `startIndex` and `count` query parameters. Clients should check the status of the returned URL to determine when conversion is complete.

## Configuration

ogr-conv depends on the following environment variables:

+ `ENVIRONMENT`: Specify `heroku` to run `ogr2ogr` from the Heroku buildpack. Specify `local` to use a local `ogr2ogr` command from the path.
+ `S3_BUCKET`: the Amazon S3 bucket to use for storing the converted shapefile ZIP
+ `S3_UPLOAD_DIR`: the S3 object prefix to use. ogr-conv will create paths under that prefix.
+ `S3_KEY`: the S3 client key ID
+ `S3_KEY`: the S3 client secret key
+ `PORT`: the port on which ogr-conv should bind. Heroku configures this for you.

The S3 bucket should have the following CORS policy, so that it can be queried from client applications:

```
<CORSConfiguration>
    <CORSRule>
        <AllowedOrigin>*</AllowedOrigin>
        <AllowedMethod>GET</AllowedMethod>
        <AllowedMethod>HEAD</AllowedMethod>
        <MaxAgeSeconds>3000</MaxAgeSeconds>
        <AllowedHeader>Authorization</AllowedHeader>
    </CORSRule>
</CORSConfiguration>
```

## Unsupported API

Because data sets can be large and conversion can take some time, these endpoints should not be used in production. For realistic data sets, the requests may very well time out.

`POST /geojson2shp`  
Post a GeoJSON file and receive a ZIP archive of the ESRI Shapefile `output.shp` and the supporting files.

`POST /geojson2shp/{basename}`  
Post a GeoJSON file and receive a ZIP archive of the ESRI Shapefile and the supporting files, named with the specified base name.

