/**
 * This is a prototype of a fully-streamable negotiated Chunk upload handling of a zip file
 * It relies on a complying client sending the proper data chunks, starting with the end of the file.
 *
 * If properly implemented it can be really efficient
 * because the server is able to never hold more than a small buffer of file data in memory
 */
'use strict';
import http from "http";
import { Readable } from "stream";
import { randomBytes } from "crypto";
import { URL } from "url";
import { find_eocd_index, zip } from "../dist/index.js";
import { parse_eocd_record } from "../dist/records/eocd.js";
import { parse_cd } from "../dist/records/cd.js";
import { eocd_length } from "../dist/constants.js";


let upload = { tail: Buffer.alloc(0) };
async function handler(req, res) {
    if (!req.headers["content-range"])
        throw new HTTPError(400, "Only Content-Range requests are allowed");
    let [, start, end, total] = /bytes (\d+)-(\d+)\/(\d+)/.exec(req.headers["content-range"])?.map(v => parseInt(v)) ?? [];
    let data = Buffer.allocUnsafe(0);
    for await (let chunk of req) {
        data = Buffer.concat([data, chunk]);
    }
    if (!upload.eocd) {
        let idx = find_eocd_index(data);
        if (idx < 0)
            throw new HTTPError(422, `Request data does not seem to contain a valid Zip central directory`);
        upload.eocd = parse_eocd_record(data.subarray(idx));
        data = data.subarray(0, -Buffer.byteLength(upload.eocd.comments) - eocd_length);
        console.log("Received \"End of Central Directory\". Skip %d bytes", Buffer.byteLength(upload.eocd.comments) - eocd_length);
    }
    if (!upload.entries) {
        // @fixme check range
        data = Buffer.concat([data, upload.tail]);
        if (data.length < upload.eocd.cd_length) {
            res.setHeader("Range", `${total - upload.eocd.cd_length - Buffer.byteLength(upload.eocd.comments) - eocd_length}-${start}/${total}`);
            upload.tail = data;
            return 202;
        }
        else {
            let entries = [...parse_cd(data.subarray(-upload.eocd.cd_length))];
            upload.entries = entries;
            data = Buffer.allocUnsafe(0);
        }
    }
    let firstEntry = upload.entries[0];
    if (data.length && upload.entries[0]) {
        if (start != firstEntry.offset)
            throw new HTTPError(400, "Bad data offset");
        if (end != firstEntry.offset + firstEntry.compressedSize)
            throw new HTTPError(400, "Bad data length");
        upload.entries.shift();
    }
    firstEntry = upload.entries[0];
    if (firstEntry) {
        res.setHeader("Range", `${firstEntry.offset}-${firstEntry.offset + firstEntry.compressedSize}/${total}`);
        return 202;
    }
    else {
        return 206;
    }
}
function* genEntries() {
    let t = new Date("'2024-12-1T11:35:32.0Z'");
    for (let i = 0; i < 5; i++) {
        let mtime = new Date(t);
        mtime.setDate(i + 1);
        yield { filename: `${i}.txt`, mtime, stream: Readable.from([randomBytes(Math.floor(Math.random() * 100))]) };
    }
}
/**
 * Make a dummy zip file in a buffer
 */
async function genZip() {
    let zipFile = Buffer.alloc(0);
    for await (let chunk of zip(genEntries())) {
        zipFile = Buffer.concat([zipFile, chunk]);
    }
    return zipFile;
}
async function client(target) {
    //to make things harder for the server, the zip's central directory is larger than one chunk.
    //However in HAS to be larger than the zip's comment section, which is generally considered to max-out at 65kb
    const chunkSize = 128;
    let buf = await genZip();
    let offset = buf.length - chunkSize;
    let chunk = buf.subarray(offset);
    while (true) {
        console.log(`Send chunk : ${offset}-${offset + chunk.length}/${buf.length}`);
        let res = await fetch(target, {
            headers: {
                "Content-Range": `bytes ${offset}-${offset + chunk.length}/${buf.length}`,
            },
            method: "POST",
            body: chunk,
        });
        if (res.status != 202) {
            console.log("DONE : ", res.status);
            break;
        }
        console.log("Received status : ", res.status);
        let [, start, end, total] = /(\d+)-(\d+)\/(\d+)/.exec(res.headers.get("Range") ?? "")?.map(v => parseInt(v)) ?? [];
        if (!Number.isInteger(start) || !Number.isInteger(end) || !Number.isInteger(total))
            throw new Error(`Bad range header : ${res.headers.get("Range")}`);
        offset = start;
        chunk = buf.subarray(start, end);
    }
}
class HTTPError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
const server = http.createServer((req, res) => {
    handler(req, res).then(code => {
        res.statusCode = code;
        res.end();
    }, e => {
        console.log("HTTP Error", e);
        res.statusCode = e.code ?? 500;
        res.end(e.message);
    });
});
server.listen(0, () => {
    let addr = server.address();
    client(new URL(`http://localhost:${addr.port}/`))
        .finally(() => {
        server.close();
    });
});
