/**
 * General purpose flags.
 */
export const flags = {
  ENCRYPTED: 1 << 0,
  COMPRESS_OPTION_1: 1 <<1,
  COMPRESS_OPTION_2: 1 << 2,
  /**If this bit is set, the fields crc-32, compressed 
   * size and uncompressed size are set to zero in the 
   * local header.  The correct values are put in the 
   * data descriptor immediately following the compressed
   * data.
  */
  USE_DATA_DESCRIPTOR: 1 <<3,
  /** Reserved for use with method 8, for enhanced deflating. */
  RESERVED_BIT: 1 << 4,
  COMPRESSED_PATCH: 1 << 5,
  UNUSED_BIT_7:  1 << 7,
  UNUSED_BIT_8:  1 << 8,
  UNUSED_BIT_9:  1 << 9,
  UNUSED_BIT_10:  1 << 10,
  UTF_FILENAME: 1 << 11,
  RESERVED_BIT_12:  1 << 12,
  ENCRYPTED_CENTRAL_DIR:  1 << 13,
  RESERVED_BIT_14:  1 << 14,
  RESERVED_BIT_15:  1 << 15,
} as const;


export enum ECompression{
  NO_COMPRESSION = 0,
  SHRINK = 1,
  REDUCE_1 = 2,
  REDUCE_2 = 3,
  REDUCE_3 = 4,
  REDUCE_4 = 5,
  IMPLODE = 6,
  //Reserved
  DEFLATE = 8,
  DEFLATE64 = 9,
  IMPLODING = 10,
  //Reserved
  BZIP2 = 12,
  //Reserved
  LZMA = 14,
}
/**
 * Supported compression methods
 */
export const compressionMethods = {
  NO_COMPRESSION: 0,
  DEFLATE: 8,
}


export const file_header_length = 30 as const
export const data_descriptor_size = 16 as const;
export const cd_header_length = 46 as const;
export const eocd_length = 22 as const;
export const extra_header_length = 4 as const;