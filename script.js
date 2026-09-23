```javascript
"use strict";

/* =========================================================
   دفتري — التطبيق المالي الشخصي
   الإصدار الأول: إدارة الشهر والتنقل بين الأشهر
   ========================================================= */


/* =========================================================
   أسماء الأشهر
   ========================================================= */

const MONTH_NAMES = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر"
];


/* =========================================================
   حالة التطبيق
   ========================================================= */

const appState = {
  currentDate: new Date(),
  monthlyData: {}
};


/* =========================================================
   عناصر الصفحة
   ========================================================= */

const elements = {
  monthName: document.getElementById("monthName"),

  previousMonth: document.getElementById("previousMonth"),
  nextMonth: document.getElementById("nextMonth"),

  remaining: document.getElementById("remaining"),
  balanceIncome: document.getElementById("balanceIncome"),
  balanceExpenses: document.getElementById("balanceExpenses"),

  income: document.getElementById("income"),
  expenses: document.getElementById("expenses"),
  savings: document.getElementById("savings"),
  owed: document.getElementById("owed")
};


/* =========================================================
   إنشاء مفتاح الشهر
   مثال:
   2026-09
   ========================================================= */

function getMonthKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");

  return `${year}-${month}`;
}


/* =========================================================
   الحصول على بيانات الشهر
   ========================================================= */

function getMonthlyData(date) {
  const key = getMonthKey(date);

  if (!appState.monthlyData[key]) {
    appState.monthlyData[key] = {
      income: 0,
      expenses: 0,
      savings: 0,
      owed: 0
    };
  }

  return appState.monthlyData[key];
}


/* =========================================================
   تنسيق الأرقام
   ========================================================= */

function formatMoney(value) {
  const number = Number(value) || 0;

  return new Intl.NumberFormat("ar-IQ").format(number);
}


/* =========================================================
   تحديث الشهر الظاهر
   ========================================================= */

function updateMonth() {

  if (!elements.monthName) {
    return;
  }

  const month = appState.currentDate.getMonth();
  const year = appState.currentDate.getFullYear();

  elements.monthName.textContent =
    `${MONTH_NAMES[month]} ${year}`;

  updateFinancialSummary();
}


/* =========================================================
   تحديث الملخص المالي
   ========================================================= */

function updateFinancialSummary() {

  const data = getMonthlyData(appState.currentDate);

  const income = Number(data.income) || 0;
  const expenses = Number(data.expenses) || 0;
  const savings = Number(data.savings) || 0;
  const owed = Number(data.owed) || 0;

  const remaining = income - expenses;


  /* المتبقي */

  if (elements.remaining) {
    elements.remaining.textContent =
      formatMoney(remaining);
  }


  /* الدخل */

  if (elements.income) {
    elements.income.textContent =
      formatMoney(income);
  }

  if (elements.balanceIncome) {
    elements.balanceIncome.textContent =
      `${formatMoney(income)} د.ع`;
  }


  /* المصروفات */

  if (elements.expenses) {
    elements.expenses.textContent =
      formatMoney(expenses);
  }

  if (elements.balanceExpenses) {
    elements.balanceExpenses.textContent =
      `${formatMoney(expenses)} د.ع`;
  }


  /* الادخار */

  if (elements.savings) {
    elements.savings.textContent =
      formatMoney(savings);
  }


  /* المبالغ المطلوبة من الآخرين */

  if (elements.owed) {
    elements.owed.textContent =
      formatMoney(owed);
  }
}


/* =========================================================
   الشهر السابق
   ========================================================= */

function goToPreviousMonth() {

  appState.currentDate.setMonth(
    appState.currentDate.getMonth() - 1
  );

  updateMonth();
}


/* =========================================================
   الشهر التالي
   ========================================================= */

function goToNextMonth() {

  appState.currentDate.setMonth(
    appState.currentDate.getMonth() + 1
  );

  updateMonth();
}


/* =========================================================
   أحداث أزرار الأشهر
   ========================================================= */

if (elements.previousMonth) {

  elements.previousMonth.addEventListener(
    "click",
    goToPreviousMonth
  );
}


if (elements.nextMonth) {

  elements.nextMonth.addEventListener(
    "click",
    goToNextMonth
  );
}


/* =========================================================
   تشغيل التطبيق
   ========================================================= */

function initializeApp() {

  console.log("دفتري بدأ التشغيل");

  updateMonth();
}


/* =========================================================
   Start
   ========================================================= */

initializeApp();
```
