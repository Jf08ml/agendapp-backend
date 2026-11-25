import express from "express";
import expenseController from "../controllers/expenseController.js";
import { requirePermission, PERMS } from "../middleware/requirePermission.js";

const router = express.Router();

// Caja: antes bastaba cualquier sesión (también la de un profesional).
router.use(requirePermission(...PERMS.cash));

router.get("/", expenseController.getExpenses);
router.post("/", expenseController.createExpense);
router.put("/:id", expenseController.updateExpense);
router.delete("/:id", expenseController.deleteExpense);

export default router;
