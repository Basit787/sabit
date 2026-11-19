import { createRoute } from "@sabit/router";

const route = createRoute("/users/[id]/posts");

export const GET = route.handle(({ params }) => ({ userId: params.id, posts: [] }));
