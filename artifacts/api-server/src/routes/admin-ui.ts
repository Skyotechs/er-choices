import { Router } from "express";

const RAILWAY_ADMIN_URL = "https://er-choices-production.up.railway.app/api/admin-ui";

const router = Router();

router.get("/admin-ui", (_req, res) => {
  res.redirect(301, RAILWAY_ADMIN_URL);
});

router.get("/admin-ui/*rest", (_req, res) => {
  res.redirect(301, RAILWAY_ADMIN_URL);
});

router.use("/admin/*rest", (_req, res) => {
  res.redirect(301, RAILWAY_ADMIN_URL);
});

export default router;
