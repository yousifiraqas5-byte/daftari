"use strict";

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

const appState = {
  currentDate: new Date(),
  monthlyData: {}
};

const elements = {
  monthName: document.getElementById("monthName"),

  previousMonth: document.getElementById("previousMonth"),
  nextMonth: document.getElementById("nextMonth"),

  remaining: document.getElementById("remaining"),

  balanceIncome:
    document.getElementById("balanceIncome"),

  balanceExpenses:
    document.getElementById("balanceExpenses"),

  income: document.getElementById("income"),

  expenses:
    document.getElementById("expenses"),

  savings:
    document.getElementById("savings"),

  owed:
    document.getElementById("owed")
};


/* =========================
   Month helpers
========================= */

function getMonthKey(date) {
  const year = date.getFullYear();

  const month = String(
    date.getMonth() + 1
  ).padStart(2, "0");

  return `${year}-${month}`;
}


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


/* =========================
   Formatting
========================= */

function formatMoney(value) {
  const number = Number(value) || 0;

  return new Intl.NumberFormat("ar-IQ").format(
    number
  );
}


/* =========================
   Update month
========================= */

function updateMonth() {
  if (!elements.monthName) {
    return;
  }

  const month =
    appState.currentDate.getMonth();

  const year =
    appState.currentDate.getFullYear();

  elements.monthName.textContent =
    `${MONTH_NAMES[month]} ${year}`;

  updateFinancialSummary();
}


/* =========================
   Financial summary
========================= */

function updateFinancialSummary() {
  const data =
    getMonthlyData(appState.currentDate);

  const income =
    Number(data.income) || 0;

  const expenses =
    Number(data.expenses) || 0;

  const savings =
    Number(data.savings) || 0;

  const owed =
    Number(data.owed) || 0;

  const remaining =
    income - expenses;


  if (elements.remaining) {
    elements.remaining.textContent =
      formatMoney(remaining);
  }


  if (elements.income) {
    elements.income.textContent =
      formatMoney(income);
  }


  if (elements.balanceIncome) {
    elements.balanceIncome.textContent =
      `${formatMoney(income)} د.ع`;
  }


  if (elements.expenses) {
    elements.expenses.textContent =
      formatMoney(expenses);
  }


  if (elements.balanceExpenses) {
    elements.balanceExpenses.textContent =
      `${formatMoney(expenses)} د.ع`;
  }


  if (elements.savings) {
    elements.savings.textContent =
      formatMoney(savings);
  }


  if (elements.owed) {
    elements.owed.textContent =
      formatMoney(owed);
  }
}


/* =========================
   Month navigation
========================= */

function goToPreviousMonth() {
  appState.currentDate.setMonth(
    appState.currentDate.getMonth() - 1
  );

  updateMonth();
}


function goToNextMonth() {
  appState.currentDate.setMonth(
    appState.currentDate.getMonth() + 1
  );

  updateMonth();
}


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


/* =========================
   Quick actions
========================= */

const addIncomeButton =
  document.getElementById("addIncomeButton");

const addExpenseButton =
  document.getElementById("addExpenseButton");

const addSavingsButton =
  document.getElementById("addSavingsButton");

const addOwedButton =
  document.getElementById("addOwedButton");


if (addIncomeButton) {
  addIncomeButton.addEventListener(
    "click",
    () => {
      alert(
        "إضافة الدخل ستكون متاحة في الخطوة القادمة."
      );
    }
  );
}


if (addExpenseButton) {
  addExpenseButton.addEventListener(
    "click",
    () => {
      alert(
        "إضافة المصروفات ستكون متاحة في الخطوة القادمة."
      );
    }
  );
}


if (addSavingsButton) {
  addSavingsButton.addEventListener(
    "click",
    () => {
      alert(
        "إدارة الادخار ستكون متاحة في الخطوة القادمة."
      );
    }
  );
}


if (addOwedButton) {
  addOwedButton.addEventListener(
    "click",
    () => {
      alert(
        "إدارة المبالغ المطلوبة ستكون متاحة في الخطوة القادمة."
      );
    }
  );
}


/* =========================
   Bottom navigation
========================= */

const navItems =
  document.querySelectorAll(".nav-item");


navItems.forEach((item) => {

  item.addEventListener(
    "click",
    () => {

      navItems.forEach((navItem) => {
        navItem.classList.remove("active");
      });

      item.classList.add("active");

    }
  );

});


/* =========================
   Initialize
========================= */

function initializeApp() {

  console.log("دفتري بدأ التشغيل");

  updateMonth();

}


initializeApp();
