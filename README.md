# Abstract Zip

A fast, low-level zip compression/decompression library designed to use the filesystem only when necessary.

Useful when a zip's content is to be consumed directly by an application. A well-suited use case is when the list of entries comes from a database (or whatever data storage) and data is stored in a blob storage like  **Amazon S3** or  **google-cloud-storage**.


## Usage

```
npm install abstract-zip
```

## API

The module has a high(_ish_) level API to zip/unzip data and automatically handle all the headers, using [Zip64](https://en.wikipedia.org/wiki/ZIP_(file_format)#ZIP64) as needed.

#### Compression

```javascript
import {Readable} from "node:stream";
import {zip} from "abstract-zip"
//entries can be an array, but for larger dataset you'd want an iterator that might be generated as-you-go
const entries = [
  {
    filename: "/foo",
    mtime: new Date(),
    isDirectory: true,
  }
  {
    filename: "/foo/bar.txt",
    mtime: new Date(),
    stream: fs.createReadStream("/path/to/file"), // Any instance of `Readable` would do
  }
];

//Consume Using generators
for await (let chunk of zip(entries /* iterable list of files and directories*/)){
  //Do something with the chunk of data
}
//Or Using streams : 
let rs = Readable.from(zip(entries));
rs.pipe(/* an Http Response or whatever you need to write to*/);
```

#### Extraction

```javascript
import {listEntries, openEntry} from "abstract-zip";
let entries = await listEntries("/path/to/archive.zip");

let rs = openEntry(entries[0]);
//Do something with the data
```

### Manual headers creation

The module also exports lower-level functions to help create Zip records from metadata. Properly assembling those records and interleaving the files data is then left as an exercise for the reader.

## Limits

### Streamed decompression

Creating a zip file can be done entirely on-the-fly, but decompressing it **safely** requires reading the end of the file first, then going back to read the files.

If fetching from the network and range requests are supported, it would be possible to safely probe for the Central Directory Record first then stream the files individually. That would also be possible from a web interface using [Blob.slice()](https://developer.mozilla.org/en-US/docs/Web/API/Blob/slice). A simplified example of such request handling is shown in the `examples` folder.

### Performance

Having minimal interactions with the filesystem should make this library pretty fast but this is **NOT** a benchmark-oriented library.

It makes heavy use of `Buffer.allocUnsafe()` (with boundary checks!) so performance might benefit from setting `Buffer.poolSize` to a higher value if you can afford the memory. Something like `files_count*200` should be a good starting point.



## Inspiration

Inspired by [node-stream-zip](https://www.npmjs.com/package/node-stream-zip) but supports creating archives.

This project is writen in typescript and aims to be dependency-free. It is not supposed to support old features (Implode, Deflate64...)  but should be able to decompress any Zip made on a reasonably recent system.

## TODO

 - strict mode to enforce spec. version requirements and verify data integrity. Implement protection against zip bombs in particular.
 - Auto-parse more known extra fields (see [extra fields](https://libzip.org/specifications/extrafld.txt))

## Development

### Running tests

```bash
npm test
# or if you want to actually test zip64:
ZIP64_TESTS=1 npm test
```

Note that Zip64 integration tests take ~10s ***per test*** to run because even when operating on dummy in-memory data, at least 2GB of data is processed through crc32. They are disabled by default and it is generally safe to not run them unless you are modifying `lib/index.ts`.

### Debugging

The high level functions are normally very quiet. Additional information about data processing is available through the [debuglog](https://nodejs.org/api/util.html#utildebuglogsection-callback) utility.

Run your code with any combination of `NODE_DEBUG=zip:entries,zip:compression,zip:zip64`, or `NODE_DEBUG=zip:*` to get all the logs.