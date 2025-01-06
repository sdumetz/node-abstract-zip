import { data_descriptor_length } from "../constants.js";
import { DataDescriptor } from "../types.js";


export function create_data_descriptor({size, compressedSize=size, crc}: DataDescriptor):Buffer{
  let dd = Buffer.allocUnsafe(data_descriptor_length);
  dd.writeUInt32LE(0x08074b50, 0);
  dd.writeUInt32LE(crc, 4);
  dd.writeUInt32LE(compressedSize, 8) //Compressed size
  dd.writeUInt32LE(size, 12); // Uncompressed size
  return dd;
}

export function parse_data_descriptor(b :Buffer):DataDescriptor{
  let signature = b.readUInt32LE(0);
  //Signature is optional in the specification and might be omitted
  if(signature === 0x08074b50) b = b.subarray(4);
  return {
    crc: b.readUInt32LE(0),
    compressedSize: b.readUInt32LE(4),
    size: b.readUInt32LE(8),
  };
}