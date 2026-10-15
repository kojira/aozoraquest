import { assertNpcImage, npcExpressionImage, NPC_EXPRESSION_NAME, NPC_IMAGE_BYTES, NPC_IMAGE_CID, readNpcImageBytes, inspectNpcImage, type NpcDef, type NpcImageKind } from '@aozoraquest/core';
import { resolveDidDocument } from './service-auth';
import { pdsEndpointFromDoc } from './oauth-metadata';
import { adminNsidRoot, type WorldAuthoringEnv } from './world-authoring';

/** This route never accepts an upstream URL/DID. Only the configured primary author's saved NPCs are public. */
export async function handleNpcImage(req: Request, env: WorldAuthoringEnv): Promise<Response> {
  const fail = (status: number) => new Response('NPC image unavailable', { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  const url = new URL(req.url);
  const id = url.searchParams.get('npcId');
  const kind = url.searchParams.get('kind');
  const cid = url.searchParams.get('cid');
  // Optional expression portrait (D-DIALOGUE-005): same record/cid checks, only for kind=portrait.
  const expression = url.searchParams.get('expression');
  if (!id || id.length > 256 || (kind !== 'sprite' && kind !== 'portrait') || !cid || !NPC_IMAGE_CID.test(cid)) return fail(400);
  if (expression !== null && (kind !== 'portrait' || expression.length > 64 || !NPC_EXPRESSION_NAME.test(expression))) return fail(400);
  const did = (env.ADMIN_DIDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)[0];
  if (!did) return fail(404);
  try {
    const doc = await resolveDidDocument(did);
    const pds = new URL(pdsEndpointFromDoc(doc as Parameters<typeof pdsEndpointFromDoc>[0], did));
    // A configured DID may migrate PDS, but must not turn this image route into a private-network proxy.
    const host = pds.hostname.toLowerCase();
    if (pds.protocol !== 'https:' || pds.username || pds.password || pds.port || pds.search || pds.hash || pds.pathname !== '/' ||
      !host.includes('.') || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) || /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) return fail(502);
    const fetchBounded = async (path: string, max: number) => {
      // Workers fetch rejects redirect: 'error'; 'manual' returns the 3xx itself, which is refused without following Location.
      const response = await fetch(`${pds.origin}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
      if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Error(`PDS redirect refused (${response.status})`); }
      if (!response.ok || !response.body) throw new Error(`PDS image read failed (${response.status})`);
      const length = response.headers.get('content-length');
      if (length && Number(length) > max) { await response.body.cancel(); throw new Error('PDS response too large'); }
      return { bytes: await readNpcImageBytes(response.body, max), type: response.headers.get('content-type')?.split(';')[0].trim() };
    };
    const query = new URLSearchParams({ repo: did, collection: `${adminNsidRoot(env)}.world.npcs`, rkey: 'self' });
    const record = JSON.parse(new TextDecoder().decode((await fetchBounded(`/xrpc/com.atproto.repo.getRecord?${query}`, 2 * 1024 * 1024)).bytes)) as { value?: { npcs?: NpcDef[] } };
    if (!Array.isArray(record.value?.npcs)) return fail(404);
    const npc = record.value.npcs.find((n) => n.id === id);
    const image = expression !== null ? (npc ? npcExpressionImage(npc, expression) : undefined) : npc?.[kind === 'sprite' ? 'spriteImage' : 'portraitImage'];
    if (!image) return fail(404);
    assertNpcImage(image, kind as NpcImageKind);
    if (image.blob.ref.$link !== cid) return fail(404);
    const blobQuery = new URLSearchParams({ did, cid });
    const { bytes, type } = await fetchBounded(`/xrpc/com.atproto.sync.getBlob?${blobQuery}`, NPC_IMAGE_BYTES[kind]);
    if (type !== image.blob.mimeType || bytes.length !== image.blob.size) return fail(422);
    const decoded = inspectNpcImage(bytes, kind);
    if (decoded.mimeType !== image.blob.mimeType || decoded.width !== image.width || decoded.height !== image.height) return fail(422);
    return new Response(bytes.slice().buffer, { headers: { 'content-type': decoded.mimeType, 'content-length': String(bytes.length), 'x-content-type-options': 'nosniff', 'cache-control': 'public, max-age=31536000, immutable', 'content-security-policy': "default-src 'none'; sandbox" } });
  } catch (err) {
    console.warn('npc-image: upstream failed', err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 200) : 'unknown error');
    return fail(502);
  }
}
