import ssh2 from 'ssh2';
const { utils }=ssh2;

// ssh2 1.17.0's test key generator strips every leading zero from the DER
// BIT STRING, including a real zero in an Ed25519 public key. Reject that
// malformed generated fixture; production never generates/retries user keys.
export function fixtureKey(options={}) {
  for (let attempt=0;attempt<8;attempt++) {
    const pair=utils.generateKeyPairSync('ed25519',options);
    const blob=Buffer.from(pair.public.split(' ')[1],'base64');
    const nameLength=blob.readUInt32BE(0);
    if (blob.readUInt32BE(4+nameLength) !== 32) continue;
    return pair;
  }
  throw new Error('Could not generate a correctly encoded test fixture key');
}
