import { QdrantClient } from '@qdrant/js-client-rest';

const client = new QdrantClient({ url: process.env.QDRANT_URL || 'http://localhost:6333' });

const VECTOR_SIZE = 3072; // Google Gemini gemini-embedding-001 dimensions

export async function createCollection(name: string): Promise<void> {
  const collections = await client.getCollections();
  const exists = collections.collections.some(c => c.name === name);
  if (!exists) {
    await client.createCollection(name, {
      vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
    });
    console.log(`[VectorStore] Created collection: ${name}`);
  }
}

export async function recreateCollection(name: string): Promise<void> {
  const collections = await client.getCollections();
  const exists = collections.collections.some(c => c.name === name);
  if (exists) {
    await client.deleteCollection(name);
    console.log(`[VectorStore] Dropped collection: ${name}`);
  }
  await client.createCollection(name, {
    vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
  });
  console.log(`[VectorStore] Recreated collection: ${name}`);
}

export async function upsert(
  collection: string,
  id: string | number,
  vector: number[],
  payload: Record<string, unknown>
): Promise<void> {
  await client.upsert(collection, {
    wait: true,
    points: [{ id, vector, payload }],
  });
}

export async function upsertBatch(
  collection: string,
  points: { id: string | number; vector: number[]; payload: Record<string, unknown> }[]
): Promise<void> {
  await client.upsert(collection, { wait: true, points });
}

export async function query(
  collection: string,
  vector: number[],
  topK: number,
  filter?: Record<string, unknown>
): Promise<{ id: string | number; score: number; payload: Record<string, unknown> }[]> {
  const results = await client.search(collection, {
    vector,
    limit: topK,
    with_payload: true,
    ...(filter ? { filter } : {}),
  });
  return results.map(r => ({
    id: r.id,
    score: r.score,
    payload: (r.payload as Record<string, unknown>) || {},
  }));
}

export async function deletePoint(collection: string, id: string | number): Promise<void> {
  await client.delete(collection, { wait: true, points: [id] });
}

export async function collectionCount(collection: string): Promise<number> {
  const info = await client.getCollection(collection);
  return info.points_count ?? 0;
}

export { client };
