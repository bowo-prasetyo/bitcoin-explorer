async function sha256Hex(hex) {
  const bytes = Uint8Array.from(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));

  const hash = await crypto.subtle.digest('SHA-256', bytes);

  return [...new Uint8Array(hash)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function doubleSHA256(hex) {
  return sha256Hex(await sha256Hex(hex));
}

export async function verifyHeaderLink(currentHeader, previousHeaderHash) {
  return currentHeader.previousblockhash === previousHeaderHash;
}

export async function verifyMerkleRoot(txids, expectedRoot) {
  if (!txids.length) return false;

  let layer = [...txids];

  while (layer.length > 1) {
    const next = [];

    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1] || left;

      next.push(await doubleSHA256(left + right));
    }

    layer = next;
  }

  return layer[0] === expectedRoot;
}
