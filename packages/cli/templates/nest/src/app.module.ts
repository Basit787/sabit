import { FileRoutesModule } from '@sabit/nest';
import { resolveRoutes } from '@sabit/router';
import { Module } from '@nestjs/common';
import { routeTree } from './sabit.route.js';

@Module({
  imports: [
    // Every api.ts in src/routes is an endpoint: src/routes/users/api.ts → /users.
    // sabit.route.ts lists them all; `sabit dev` keeps it up to date.
    FileRoutesModule.forRoot({ routes: resolveRoutes(routeTree) }),
  ],
})
export class AppModule {}
