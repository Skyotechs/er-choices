const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const context = { exports: {}, URL };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(__dirname + "/../src/index.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, context);
const api = context.exports;
const entry = (patch = {}) => ({
  category: "Trauma", classification: "Level II Trauma Center", population: "Adult",
  status: "verified", authority: "Fixture state authority",
  sourceUrl: "https://authority.example/hospital-42", verifiedOn: "2026-01-01",
  officialConfirmed: true, ...patch,
});
test("legacy tags and hospital-wide verified flag never certify a Speciality", () => {
  assert.equal(api.readSpecialityState({ Trauma: "acs", verified: true }).entries.length, 0);
  assert.equal(api.verifiedSpecialityEntries(undefined).length, 0);
  assert.equal(api.specialityCategories(["Trauma"]).length, 0);
});
test("every checklist category can be selected together, saved, and displayed without extra fields", () => {
  const saved = api.recordAdminSpecialities(api.SPECIALITY_CATEGORIES.map(category => ({category})));
  assert.equal(saved.length, api.SPECIALITY_CATEGORIES.length);
  for (const category of ["General Acute Care", "Critical Access", "Women", "Trauma", "Burn", "Pediatric", "Obstetrics", "Cancer"]) {
    assert.ok(api.specialityCategories(saved).includes(category), category);
    assert.ok(api.specialityGroups(saved).some(group => group.label === category), category);
  }
  assert.ok(saved.every(entry => entry.officialConfirmed && entry.classification === entry.category));
});
test("supporting details are optional, but malformed values and unconfirmed public data are rejected", () => {
  for (const patch of [
    { officialConfirmed: false },
    { verifiedOn: "2026-02-30" }, { verifiedOn: "2099-01-01" },
    { sourceUrl: "javascript:alert(1)" }, { sourceUrl: "http://authority.example/" },
    { sourceUrl: "https://user:password@authority.example/" },
  ]) assert.throws(() => api.validateSpecialityEntries([entry(patch)], "2026-10-16"));
  assert.equal(api.validateSpecialityEntries([entry()], "2026-10-16").length, 1);
  assert.equal(api.validateSpecialityEntries([entry({ authority: "", sourceUrl: "", verifiedOn: "" })]).length, 1);
});
test("category alone OR classification alone is enough, with no population entry or invented category", () => {
  const categoryOnly = api.recordAdminSpecialities([{ category: "Trauma" }]);
  assert.equal(categoryOnly[0].classification, "Trauma");
  assert.equal(categoryOnly[0].population, "All");
  assert.equal(api.specialityCategories(categoryOnly)[0], "Trauma");
  assert.equal(api.specialityGroups(categoryOnly)[0].label, "Trauma");
  assert.equal(api.specialityGroups(categoryOnly)[0].subs.length, 0, "category-only labels are not duplicated");
  const levelOnly = api.recordAdminSpecialities([{ classification: "Level II" }]);
  assert.equal(levelOnly[0].category, null);
  assert.equal(levelOnly[0].classification, "Level II");
  assert.equal(api.specialityGroups(levelOnly)[0].subs[0], "Level II");
  assert.equal(api.specialityCategories(levelOnly).length, 0, "a bare level must not become Trauma");
  assert.throws(() => api.recordAdminSpecialities([{}]));
  assert.throws(() => api.recordAdminSpecialities([{ category: null, classification: "  " }]));
  assert.throws(() => api.recordAdminSpecialities([{ category: "Trauma" }, { category: "Trauma" }]));
  assert.throws(() => api.recordAdminSpecialities([{ classification: "Level II" }, { classification: "Level II" }]));
  assert.equal(api.recordAdminSpecialities([{ classification: "Level II" }, { classification: "Comprehensive Stroke Center" }]).length, 2);
});
test("authenticated admin recording needs only classification fields and preserves existing supporting details", () => {
  const minimal = { category: "Stroke", classification: "Comprehensive Stroke Center", population: "All" };
  const saved = api.recordAdminSpecialities([minimal], [], "2026-10-16");
  assert.equal(saved[0].status, "verified");
  assert.equal(saved[0].officialConfirmed, true);
  assert.equal(saved[0].authority, "");
  assert.equal(saved[0].sourceUrl, "");
  assert.equal(saved[0].verifiedOn, "2026-10-16");
  assert.equal(api.specialityCategories(saved)[0], "Stroke");
  const previous = entry();
  const preserved = api.recordAdminSpecialities([{ category: previous.category, classification: previous.classification, population: previous.population }], [previous], "2026-10-16");
  assert.equal(preserved[0].authority, previous.authority);
  assert.equal(preserved[0].sourceUrl, previous.sourceUrl);
  assert.equal(preserved[0].verifiedOn, previous.verifiedOn);
});
test("unverified drafts stay reviewable, never enter public groups or filters", () => {
  const draft = entry({ status: "unverified", authority: "", sourceUrl: "", verifiedOn: "", officialConfirmed: false });
  assert.equal(api.validateSpecialityEntries([draft]).length, 1);
  assert.equal(api.specialityGroups([draft]).length, 0);
});
test("duplicate and conflicting overlapping populations are rejected, adult and pediatric can coexist", () => {
  assert.throws(() => api.validateSpecialityEntries([entry(), entry()]));
  assert.throws(() => api.validateSpecialityEntries([entry(), entry({ classification: "Level I" })]));
  assert.throws(() => api.validateSpecialityEntries([entry(), entry({ population: "All" })]));
  const mixed = [entry(), entry({ population: "Pediatric", classification: "Level I Pediatric Trauma Center" })];
  assert.equal(api.validateSpecialityEntries(mixed).length, 2);
  assert.equal(api.specialityCategories(mixed).includes("Pediatric"), true);
  assert.equal(api.specialityGroups(mixed)[0].subs.length, 2);
});
test("malformed evidence fails closed rather than reviving inferred specialties", () => {
  assert.equal(api.verifiedSpecialityEntries([entry({ officialConfirmed: false })]).length, 0);
  assert.throws(() => api.readSpecialityState({ _specialityV1: { entries: [entry()] } }));
});
test("web and Android filters and details use identical admin-confirmed rules without evidence fields", () => {
  function load(file) {
    const filters = ["All", "Trauma", "Stroke", "Pediatric", "Obstetrics", "Burn", "Psychiatric"];
    const sandbox = { exports: {}, URL, require(name) {
      if (name === "@workspace/speciality") return api;
      if (name === "@/types/hospital") return { DESIGNATION_FILTERS: filters };
      throw new Error("Unexpected dependency " + name);
    } };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, sandbox);
    return sandbox.exports;
  }
  const root = __dirname + "/../../../";
  const web = load(root + "artifacts/er-choices-web/src/services/designationUtils.ts");
  const android = load(root + "artifacts/closest-hospital/services/hospitalService.ts");
  const legacy = { categories: ["Trauma"], specialties: ["Trauma"], actualDesignation: "Level I Trauma Center", strokeDesignation: "Primary", serviceLine: "Psychiatric" };
  for (const client of [web, android]) {
    assert.equal(client.matchesDesignationFilter(legacy, "All"), true);
    for (const category of ["Trauma", "Stroke", "Psychiatric"]) assert.equal(client.matchesDesignationFilter(legacy, category), false);
    assert.equal(client.buildDesignationGroups(legacy).length, 0);
    const hospital = { ...legacy, specialities: [entry({ population: "Pediatric", authority: "", sourceUrl: "", verifiedOn: "" })] };
    assert.equal(client.matchesDesignationFilter(hospital, "Pediatric"), true);
    assert.equal(client.matchesDesignationFilter(hospital, "Trauma"), true);
    assert.equal(client.buildDesignationGroups(hospital)[0].subs[0], "Pediatric — Level II Trauma Center");
  }
});
