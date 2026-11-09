// spv.js
// Building blocks for verifying Bitcoin data in the browser.
//
// Not wired into the UI yet: this is the foundation for the verification
// features on the roadmap (see VISION.md). Covered by tests/spv.test.mjs.
//
// Byte order: block hashes, txids and merkle roots are *displayed*
// (and returned by Esplora APIs) byte-reversed relative to the order
// they are hashed in. Functions here take and return display order.

function hexToBytes(hex) {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    throw new Error('Invalid hex string');
  }

  const bytes = new Uint8Array(hex.length / 2);

  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }

  return bytes;
}

function bytesToHex(bytes) {
  return [...bytes]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function reverseHex(hex) {
  return bytesToHex(hexToBytes(hex).reverse());
}

async function sha256(bytes) {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', bytes)
  );
}

// SHA256(SHA256(bytes)) over raw bytes given as hex; returns hex in the
// same (internal) byte order.
export async function doubleSHA256(hex) {
  return bytesToHex(await sha256(await sha256(hexToBytes(hex))));
}

export function verifyHeaderLink(currentHeader, previousHeaderHash) {
  return currentHeader.previousblockhash === previousHeaderHash;
}

// Computes the merkle root of a block's txids (display order, in block
// order) and returns it in display order.
export async function computeMerkleRoot(txids) {
  if (!txids.length) {
    throw new Error('A block has at least one transaction');
  }

  let layer = txids.map(reverseHex);

  while (layer.length > 1) {
    const next = [];

    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1] ?? left; // odd count: pair with itself

      next.push(await doubleSHA256(left + right));
    }

    layer = next;
  }

  return reverseHex(layer[0]);
}

export async function verifyMerkleRoot(txids, expectedRoot) {
  if (!txids.length) {
    return false;
  }

  return (await computeMerkleRoot(txids)) === expectedRoot.toLowerCase();
}
