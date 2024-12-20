import assert from "node:assert";

import { file_header_length, data_descriptor_size } from "../constants.js";
import { FileHeader } from "../types.js";
import { DateTime } from "../utils/datetime.js";
import { create_extra_header, parse_extra_header } from "./extra.js";


export function create_file_header({ filename, extra, mtime, flags, compression = 0 } :FileHeader):Buffer{
  let name_length = Buffer.byteLength(filename);
  let extraData = create_extra_header(extra);

  let header = Buffer.alloc(file_header_length + Buffer.byteLength(filename) +extraData.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4); // Version 2.0 needed (deflate and folder support)
  header.writeUInt16LE(flags, 6);                     // General purpose flags
  header.writeUInt16LE(compression, 8)  // compression : 0 - none or 8 - Deflate
  // mtime time and date
  // see: https://learn.microsoft.com/fr-fr/windows/win32/api/winbase/nf-winbase-dosdatetimetofiletime?redirectedfrom=MSDN
  header.writeUInt32LE(DateTime.toDos(mtime), 10); // DOS time & date
  //CRC32 and sizes set to 0 because GP bit 3 is set
  header.writeUInt32LE(0, 14);// crc32
  header.writeUInt32LE(0, 18);// compressed size
  header.writeUInt32LE(0, 22);// uncompressed size
  
  header.writeUInt16LE(name_length, 26); // Name length
  header.writeUInt16LE(extraData.length, 28); //extra length
  header.write(filename, 30, "utf-8"); // name
  extraData.copy(header, 30+name_length);
  return header;
}


export function parse_file_header(b :Buffer) :FileHeader{
  const start_bytes = b.readUInt32LE(0);
  assert(start_bytes === 0x04034b50, `Not a valid zip file header. expected 0x04034b50 but starting with 0x${start_bytes.toString(16)}`);
  const version = b.readUInt16LE(4);
  const flags = b.readUInt16LE(6);
  const compression = b.readUInt16LE(8);
  const dosTime =b.readUInt32LE(10);
  const mtime = DateTime.toUnix(dosTime);

  const name_length = b.readUInt16LE(26);
  const extra_length = b.readUInt16LE(28);

  const filename = b.slice(30, 30+name_length).toString("utf-8");
    let extra = parse_extra_header(b.subarray(30 + name_length, 30+name_length+extra_length));
  return {filename, mtime, extra, flags, compression};
}
