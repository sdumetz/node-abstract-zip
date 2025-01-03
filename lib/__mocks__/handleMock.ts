import type { FileHandle } from "node:fs/promises";

/**
 * Dummy mock for `node:fs.FileHandle`
 */
export default class HandleMock{
  data = Buffer.alloc(64*1024);
  size :number = 0;

  static Create(...buffers :Buffer[]){
    return new HandleMock(...buffers) as any as FileHandle;
  }

  constructor(...buffers:Buffer[]){
    for(let b of buffers){
      this._write(b);
    }
  }
  _write(d :Buffer){
    if(this.data.length < (this.size + d.length)){
      this.data = Buffer.concat([this.data, Buffer.alloc(Math.max(d.length, 64*1024))]);
    }
    this.size += d.copy(this.data, this.size, 0, d.length);
  }

  async stat(){
    return Promise.resolve({
      size: this.size,
    });
  }

  async read({buffer, position} :{buffer:Buffer, position :number}){
    let end = Math.min(position + buffer.length, this.size);
    return Promise.resolve({bytesRead: this.data.copy(buffer, 0, position, end)});
  }
  /**
   * This is totally fake and unusable but we don't expect to be consuming the read stream for real
   */
  async createReadStream({start, end}:{start:number, end:number}){
    return this.data.slice(start, end);
  }
}
