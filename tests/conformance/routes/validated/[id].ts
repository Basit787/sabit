import { createRoute } from "@sabit/router";
import { z } from "zod";

const route = createRoute("/validated/[id]");

export const POST = route.handle(
  {
    params: z.object({ id: z.coerce.number().int() }),
    body: z.object({ name: z.string().min(1) }),
  },
  ({ params, body }) => ({ id: params.id, name: body.name }),
);
