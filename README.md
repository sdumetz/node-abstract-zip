# Abstract Zip

A fast, low-level zip compression/decompression library designed to use the filesystem only when necessary.

Useful when a zip's content is to be consumed directly by an application. A well-suited use case is when the list of entries comes from a database (or whatever data storage) and data is stored in a blob storage like  **Amazon S3** or  **google-cloud-storage**.


## Usage

```
npm install abstract-zip
```

## Resources


## Limits

Creating a zip file can be done entirely on-the-fly, but decompressing it **safely** requires reading the end of the file first, then going back to read the files.

If fetching from the network and range requests are supported, it would be possible to safely probe for the Central Directory Record first then stream the files individually. That would _probably_ also be possible from a web interface using [Blob.slice()](https://developer.mozilla.org/en-US/docs/Web/API/Blob/slice). However such an implementation would require some creative request handling.

## Inspiration

Inspired by [node-stream-zip](https://www.npmjs.com/package/node-stream-zip) but supports creating archives.

