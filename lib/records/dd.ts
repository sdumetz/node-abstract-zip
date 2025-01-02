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