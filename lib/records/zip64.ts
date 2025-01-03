import assert from "node:assert";
import { zip64_eocd_length, zip64_locator_length, zip64_extra_header_length, zip64_data_descriptor_length } from "../constants.js";
import { CDHeader, DataDescriptor, ExtraData } from "../types.js"
import { EOCDRecord, EOCDRecordParams } from "./eocd.js"

/**
 * 
 * @note Zip64's max size should be 2^64-1
 * But because we use js's native numbers we are limited to MAX_SAFE_INTEGER,
 * That is 2^53 -1 or 9PB of data. Hopefully nobody will notice.
 * If you do notice, please submit a feature request for BigInt support.
 */
export interface Zip64EOCDRecord extends Omit<EOCDRecord, "comments">{
  ext: ExtraData;
  made_by :number;
  version :number;
  version_needed :number;
}

export interface Zip64EOCDRecordParams extends Omit<EOCDRecordParams, "comments">{
  ext?: ExtraData;
}

export type Zip64ExtraField = Pick<CDHeader, "size"|"compressedSize"|"offset">;

/**
 * Encodes metadata into a Zip64 End of Central Directory Record
 * Includes the Zip64 End of Central Directory Locator trailer 
 */
export function create_zip64_eocd_record(record :Zip64EOCDRecordParams) :Buffer{
  let extra_size = 0;

  
  for(let data of (record.ext ?? []).values()){
    extra_size += zip64_extra_header_length + data.length;
  }


  let offset = 0;
  const b = Buffer.allocUnsafe(zip64_eocd_length + extra_size + zip64_locator_length);
  // signature                       4 bytes  (0x06064b50)
  offset = b.writeUInt32LE(0x06064b50, offset)
  // size of zip64 end of central
  // directory record                8 bytes
  offset = b.writeBigUInt64LE(BigInt(zip64_eocd_length + extra_size - 12), offset);
  // version made by                 2 bytes
  offset = b.writeUInt16LE( 3 << 8 | 45, offset); // made by UNIX with zip v4.5
  // version needed to extract       2 bytes
  offset = b.writeUInt16LE( 45, offset); // Need zip v4.5 (Zip64)
  // number of this disk             4 bytes
  offset = b.writeUInt32LE( 0, offset);
  // number of the disk with the 
  // start of the central directory  4 bytes
  offset = b.writeUInt32LE( 0, offset);
  // total number of entries in the
  // central directory on this disk  8 bytes
  offset = b.writeBigUInt64LE( BigInt(record.files_count), offset);
  // total number of entries in the
  // central directory               8 bytes
  offset = b.writeBigUInt64LE( BigInt(record.files_count), offset);
  // size of the central directory   8 bytes
  offset = b.writeBigUInt64LE( BigInt(record.cd_length), offset);
  // offset of start of central
  // directory with respect to
  // the starting disk number        8 bytes
  offset = b.writeBigUInt64LE( BigInt(record.data_length), offset);
  // zip64 extensible data sector    (variable size)
  for(let [id, data] of (record.ext ?? []).entries()){
    offset = b.writeUInt16LE(id, offset);
    offset = b.writeUInt32LE(data.length, offset);
    offset += data.copy(b, offset);
  }


  // zip64 end of central dir locator 
  // signature                       4 bytes  (0x07064b50)
  offset = b.writeUInt32LE(0x07064b50, offset);
  // number of the disk with the
  // start of the zip64 end of 
  // central directory               4 bytes
  offset = b.writeUInt32LE(0, offset);
  // relative offset of the zip64
  // end of central directory record 8 bytes
  offset = b.writeBigUInt64LE(BigInt(record.data_length + record.cd_length), offset);
  // total number of disks           4 bytes
  offset = b.writeUInt32LE(1, offset);
  assert(offset === b.length, `Size mismatch. Offset is at ${offset} but buffer is ${b.length} bytes long`);
  return b;
}


export function parse_zip64_eocd_record(b :Buffer, strict = true) :Zip64EOCDRecord{
  // zip64 end of central dir 
  // signature                       4 bytes  (0x06064b50)
  const signature = b.readUInt32LE(0);
  if(strict) assert(signature ==0x06064b50, `Expect Zip64 end of central directory record to start with 0x06064b50, found 0x${signature.toString(16).padStart(8, "0")}`);
  

  // size of zip64 end of central
  // directory record                8 bytes
  const record_length = Number(b.readBigUInt64LE(4)) + 12;
  assert(record_length <= b.length, `Buffer is ${b.length} bytes long but ${record_length} bytes are expected`);
  // version made by                 2 bytes
  const version = b.readUInt8(12);
  const made_by = b.readUInt8(13);
  // version needed to extract       2 bytes
  const version_needed = b.readUInt16LE(14);
  if(strict){
    // number of this disk             4 bytes
    const disk_number = b.readUInt32LE(16);
    // number of the disk with the 
    // start of the central directory  4 bytes
    const cd_disk_number = b.readUInt32LE(20);
    assert(cd_disk_number === disk_number, `Central directory is on disk ${cd_disk_number} (this is disk ${disk_number})`);
  }
  // total number of entries in the
  // central directory on this disk  8 bytes
  const files_count = Number(b.readBigUInt64LE(24));
  if(strict){
    // total number of entries in the
    // central directory               8 bytes
    const total_files_count = Number(b.readBigUInt64LE(32));
    assert(total_files_count === files_count, `Expected the whole Zip to have ${files_count} files but total files count is set to ${total_files_count}`);
  }
  // size of the central directory   8 bytes
  const cd_length = Number(b.readBigUInt64LE(40));
  // offset of start of central
  // directory with respect to
  // the starting disk number        8 bytes
  const data_length = Number(b.readBigUInt64LE(48));

  // zip64 extensible data sector    (variable size)
  const ext :ExtraData = new Map(); 
  let offset = zip64_eocd_length;
  while(offset < record_length){
    let id = b.readUInt16LE(offset);
    let data_length = b.readUInt32LE(offset +2);
    let data = Buffer.allocUnsafe(data_length);
    offset += zip64_extra_header_length;
    offset += b.copy(data, 0, offset, offset + data_length);
    ext.set(id, data);
  }

  if(strict && record_length + zip64_locator_length <= b.length){
    const signature = b.readUInt32LE(offset);
    offset +=4;
    assert(signature === 0x07064b50, `Expect Zip64 locator to start with signature 0x07064b50, but read 0x${signature.toString(16)}`);
  }

  return {
    made_by,
    version,
    version_needed,
    files_count,
    cd_length,
    data_length,
    ext,
  };
}

/**
 * Parse the Zip64 End of Central Directory Locator to get the Record's byte offset
 * The structure is as follow : 
 * ```text
 * zip64 end of central dir locator 
 * signature                       4 bytes  (0x07064b50)
 * 
 * number of the disk with the
 * start of the zip64 end of 
 * central directory               4 bytes
 * 
 * relative offset of the zip64
 * end of central directory record 8 bytes
 * 
 * total number of disks           4 bytes
 * ```
 */
export function parse_zip64_eocd_locator( b :Buffer, strict = false): number{
  // zip64 end of central dir locator 
  // signature                       4 bytes  (0x07064b50)
  const signature = b.readUInt32LE(0);
  assert(signature === 0x07064b50, `Expect Zip64 locator to start with signature 0x07064b50, but read 0x${signature.toString(16)}`);
  
  if(strict){
    // total number of disks           4 bytes
    let disk_number = b.readUInt32LE(16);
    assert(disk_number === 1, `Only single-file archives are supported`);
  }

  // relative offset of the zip64
  // end of central directory record 8 bytes
  return Number(b.readBigUInt64LE(8));
}


/**
 * This buffer is to be used with a Zip64 `0x0001` extra field for a file header or central directory record when necessary
 */
export function create_zip64_extra_field({size, compressedSize, offset} :Zip64ExtraField) :Buffer{
  let b = Buffer.allocUnsafe(28);

  // Original Size          8 bytes    Original uncompressed file size
  b.writeBigUInt64LE(BigInt(size), 0);
  // Compressed Size        8 bytes    Size of compressed data
  b.writeBigUInt64LE(BigInt(compressedSize), 8);
  // Relative Header Offset 8 bytes    Offset of local header record
  b.writeBigUInt64LE(BigInt(offset), 16)
  // Disk Start Number      4 bytes    Number of the disk on which this file starts
  b.writeUInt32LE(0, 24);
  return b;
}

/**
 * Parses the data part of a 0x0001 extra field
 */
export function parse_zip64_extra_field(b :Buffer) :Zip64ExtraField{
  assert( b.length != 24, `Zip64 extra field should have a length of 24. Received ${b.length}`);
  return {
    size: Number(b.readBigUint64LE(0)),
    compressedSize: Number(b.readBigUint64LE(8)),
    offset:  Number(b.readBigUint64LE(16))
  }
}

/**
 * Zip64 version of the data descriptor
 * This MUST be used if the 0x0001 extra field is present on the file header.
 * This MAY be used with files that don't really require Zip64 (ie. use it if size isn't known in advance)  
 */
export function create_zip64_data_descriptor({size, compressedSize=size, crc} :DataDescriptor) :Buffer{
  let dd = Buffer.allocUnsafe(zip64_data_descriptor_length);
  dd.writeUInt32LE(0x08074b50, 0);
  dd.writeUInt32LE(crc, 4);
  dd.writeBigUInt64LE(BigInt(compressedSize), 8) //Compressed size
  dd.writeBigUInt64LE(BigInt(size), 16); // Uncompressed size
  return dd;
}

/**
 * Parse a Zip64 data descriptor buffer (With or without signature)
 */
export function parse_zip64_data_descriptor( b: Buffer) :DataDescriptor{
  if( 20 < b.length  && b.readUInt32LE(0) === 0x08074b50)  b = b.subarray(4);

  return {
    crc: b.readUInt32LE(0),
    compressedSize: Number(b.readBigUInt64LE(4)),
    size: Number(b.readBigUInt64LE(12)),
  }
}