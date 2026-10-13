import { homeFor, navigate, startRouter } from "./router";
import { renderLogin, renderChangePassword } from "./pages/auth";
import { renderStudentHome, renderStudentAssignment } from "./pages/student";
import { renderTeacherDashboard } from "./pages/teacherDashboard";
import { renderTeacherReview } from "./pages/teacherReview";
import { renderTeacherStudents } from "./pages/teacherStudents";
import { renderTeacherAssignmentEditor, renderTeacherAssignments } from "./pages/teacherAssignments";
import { el } from "./dom";
import { isConfigured } from "./supabase";
import { initTheme } from "./theme";

initTheme();

const app = document.getElementById("app")!;

if (!isConfigured) {
  app.append(el("main", { class: "container" }, el("div", { class: "card narrow" },
    el("h1", {}, "Configuration manquante"),
    el("p", {}, "Le site a été construit sans VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY."),
    el("p", { class: "muted" }, "Définissez ces variables (web/.env.local en local, ou variables du dépôt GitHub pour le déploiement), puis reconstruisez."),
  )));
} else startRouter(app, [
  { path: "/", public: true, render: (_main, _params, me) => navigate(me ? homeFor(me) : "/login", true) },
  { path: "/login", render: renderLogin, public: true },
  { path: "/mot-de-passe", render: renderChangePassword },
  { path: "/eleve", render: renderStudentHome, audience: "student" },
  { path: "/eleve/devoir/:id", render: renderStudentAssignment, audience: "student" },
  { path: "/enseignant", render: renderTeacherDashboard, audience: "staff" },
  { path: "/enseignant/remise/:id", render: renderTeacherReview, audience: "staff" },
  { path: "/enseignant/eleves", render: renderTeacherStudents, audience: "staff" },
  { path: "/enseignant/devoirs", render: renderTeacherAssignments, audience: "staff" },
  { path: "/enseignant/devoirs/nouveau", render: renderTeacherAssignmentEditor, audience: "staff" },
  { path: "/enseignant/devoirs/:id", render: renderTeacherAssignmentEditor, audience: "staff" },
]);
