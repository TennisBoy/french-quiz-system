// deno test supabase/functions/_shared
import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { validateStudent } from "./students.ts";
import { generateTempPassword } from "./password.ts";

Deno.test("validateStudent accepts and normalizes a TDSB student", () => {
  assertEquals(validateStudent({ email: " 123456789@TDSB.ca ", first_name: "Léa ", last_name: "Gagnon" }), {
    email: "123456789@tdsb.ca",
    first_name: "Léa",
    last_name: "Gagnon",
  });
});

Deno.test("validateStudent rejects other domains and missing names", () => {
  assertEquals(typeof validateStudent({ email: "a@gmail.com", first_name: "A", last_name: "B" }), "string");
  assertEquals(typeof validateStudent({ email: "a@tdsb.on.ca", first_name: "A", last_name: "B" }), "string");
  assertEquals(typeof validateStudent({ email: "1@tdsb.ca", first_name: "", last_name: "B" }), "string");
});

Deno.test("generateTempPassword format", () => {
  for (let i = 0; i < 100; i++) {
    assertMatch(generateTempPassword(), /^[a-hj-km-np-z2-9]{4}(-[a-hj-km-np-z2-9]{4}){2}$/);
  }
});
