import express from "express";
import expenseController from "../controllers/expenseController.js";

const router = express.Router();

router.get("/", expenseController.getExpenses);
router.post("/", expenseController.createExpense);
router.put("/:id", expenseController.updateExpense);
router.delete("/:id", expenseController.deleteExpense);

export default router;
