import { Router, type IRouter } from "express";
import healthRouter from "./health";
import reportsRouter from "./reports";
import specialtiesRouter from "./specialties";
import adminUiRouter from "./admin-ui";

const router: IRouter = Router();

router.use(healthRouter);
router.use(reportsRouter);
router.use(specialtiesRouter);
router.use(adminUiRouter);

export default router;
