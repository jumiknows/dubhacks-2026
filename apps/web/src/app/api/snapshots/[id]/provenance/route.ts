import { provenanceFor } from "../../../../../lib/server/catalog";

export function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return context.params.then(({ id }) => {
    const result = provenanceFor(id);
    if ("error" in result) return result.error;
    return Response.json(result.provenance);
  });
}
