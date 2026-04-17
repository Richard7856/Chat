declare module "tweetnacl-util" {
  export function decodeUTF8(s: string): Uint8Array;
  export function encodeUTF8(b: Uint8Array): string;
  export function encodeBase64(b: Uint8Array): string;
  export function decodeBase64(s: string): Uint8Array;
}
