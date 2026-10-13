// npm run functions:test
import { assertEquals, assertMatch } from "@std/assert";
import { validateAccount } from "./accounts.ts";
import { generateTempPassword } from "./password.ts";

Deno.test("validateAccount accepts and normalizes a row for the school's domain", () => {
  assertEquals(validateAccount({ email: " 123456789@TDSB.ca ", first_name: "Léa ", last_name: "Gagnon" }, "tdsb.ca"), {
    email: "123456789@tdsb.ca",
    first_name: "Léa",
    last_name: "Gagnon",
    honorific: null,
  });
  assertEquals(
    validateAccount({ email: "marie.dupont@tdsb.on.ca", first_name: "Marie", last_name: "Dupont", honorific: " Mme " }, "tdsb.on.ca"),
    { email: "marie.dupont@tdsb.on.ca", first_name: "Marie", last_name: "Dupont", honorific: "Mme" },
  );
});

Deno.test("validateAccount rejects other domains and missing names", () => {
  assertEquals(typeof validateAccount({ email: "a@gmail.com", first_name: "A", last_name: "B" }, "tdsb.ca"), "string");
  assertEquals(typeof validateAccount({ email: "a@tdsb.on.ca", first_name: "A", last_name: "B" }, "tdsb.ca"), "string");
  assertEquals(typeof validateAccount({ email: "a@b@tdsb.ca", first_name: "A", last_name: "B" }, "tdsb.ca"), "string");
  assertEquals(typeof validateAccount({ email: "1@tdsb.ca", first_name: "", last_name: "B" }, "tdsb.ca"), "string");
  assertEquals(typeof validateAccount(null, "tdsb.ca"), "string");
});

Deno.test("generateTempPassword format", () => {
  for (let i = 0; i < 100; i++) {
    assertMatch(generateTempPassword(), /^[a-hj-km-np-z2-9]{4}(-[a-hj-km-np-z2-9]{4}){2}$/);
  }
});
