import { createRoute } from "../../../../../../src/index.ts";

const route = createRoute("/users/[id]/posts");

export const GET = route.handle(({ params }) => ({ userId: params.id, posts: [] }));
