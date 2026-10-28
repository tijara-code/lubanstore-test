/** What the `pg` project runs when LM_TEST_PG_URL is not set (vitest.config.ts): nothing, said so. */
import { it } from "vitest";

it.skip("the server suite on PostgreSQL: set LM_TEST_PG_URL (npm run test:pg) to run it", () => {});
