import { getStore } from '@netlify/blobs';
export default async (req) => {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^[a-f0-9]{12}$/.test(id)) return new Response('Invalid model id', { status: 400 });
  const store = getStore('krutilka-models');
  const blob = await store.get(`models/${id}.glb`, { type: 'arrayBuffer' });
  if (!blob) return new Response('Model not found', { status: 404 });
  return new Response(blob, { headers: { 'content-type': 'model/gltf-binary', 'cache-control': 'public, max-age=3600' } });
};
