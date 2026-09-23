/* =========================================================
   DAFTARI
   Local-only personal life organizer
========================================================= */

"use strict";

/* =========================================================
   STORAGE
========================================================= */

const STORAGE_KEY = "daftari_v2";

const DEFAULT_MONTH_SETTINGS = {
    loan: 425000,
    fuelBudget: 200000,
    mobileInternet: 40000,

    homeContribution: 550000,
    norhanContribution: 550000,

    generator: 100000,
    homeInternet: 35000,
    rent: 650000
};

const MONTH_NAMES = [
    "كانون الثاني",
    "شباط",
    "آذار",
    "نيسان",
    "أيار",
    "حزيران",
    "تموز",
    "آب",
    "أيلول",
    "تشرين الأول",
    "تشرين الثاني",
    "كانون الأول"
];


/* =========================================================
   APP STATE
========================================================= */

const now = new Date();

let currentYear = now.getFullYear();
let currentMonth = now.getMonth();

let activePage = "homePage";
let toastTimer = null;


/* =========================================================
   DOM HELPERS
========================================================= */

function $(id) {
    return document.getElementById(id);
}

function setText(id, value) {
    const element = $(id);

    if (element) {
        element.textContent = value;
    }
}

function currency(value) {
    const number = Number(value) || 0;

    return `${number.toLocaleString("en-US")} د.ع`;
}

function numberValue(value) {
    const number = Number(value);

    if (!Number.isFinite(number) || number < 0) {
        return 0;
    }

    return Math.round(number);
}

function monthKey(year = currentYear, month = currentMonth) {
    return `${year}-${String(month + 1).padStart(2, "0")}`;
}


/* =========================================================
   DEFAULT DATA
========================================================= */

function createMonth(year, month) {
    return {
        year,
        month,

        settings: {
            ...DEFAULT_MONTH_SETTINGS
        },

        savings: null,

        expenses: [],

        carExpenses: [],

        homeExpenses: []
    };
}


/* =========================================================
   DATABASE
========================================================= */

function loadDatabase() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);

        if (!saved) {
            return {
                months: {}
            };
        }

        const database = JSON.parse(saved);

        if (!database || typeof database !== "object") {
            return {
                months: {}
            };
        }

        if (!database.months || typeof database.months !== "object") {
            database.months = {};
        }

        return database;

    } catch (error) {
        console.error("Daftari storage error:", error);

        return {
            months: {}
        };
    }
}

let database = loadDatabase();


function saveDatabase() {
    try {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(database)
        );
    } catch (error) {
        console.error("Unable to save Daftari data:", error);

        showToast("تعذر حفظ البيانات على الجهاز");
    }
}


function ensureCurrentMonth() {
    const key = monthKey();

    if (!database.months[key]) {
        database.months[key] = createMonth(
            currentYear,
            currentMonth
        );

        saveDatabase();
    }

    normalizeMonth(database.months[key]);

    return database.months[key];
}


function normalizeMonth(month) {
    if (!month.settings || typeof month.settings !== "object") {
        month.settings = {};
    }

    Object.keys(DEFAULT_MONTH_SETTINGS).forEach((key) => {
        if (
            month.settings[key] === undefined ||
            month.settings[key] === null ||
            Number.isNaN(Number(month.settings[key]))
        ) {
            month.settings[key] = DEFAULT_MONTH_SETTINGS[key];
        }
    });

    if (!Array.isArray(month.expenses)) {
        month.expenses = [];
    }

    if (!Array.isArray(month.carExpenses)) {
        month.carExpenses = [];
    }

    if (!Array.isArray(month.homeExpenses)) {
        month.homeExpenses = [];
    }

    if (month.savings === undefined) {
        month.savings = null;
    }

    return month;
}


function getCurrentMonthData() {
    return ensureCurrentMonth();
}


function getSettings() {
    return getCurrentMonthData().settings;
}


/* =========================================================
   MONTH NAVIGATION
========================================================= */

function updateMonthHeader() {
    setText(
        "currentMonthName",
        MONTH_NAMES[currentMonth]
    );

    setText(
        "currentMonthYear",
        currentYear
    );
}


function changeMonth(direction) {
    currentMonth += direction;

    if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
    }

    if (currentMonth < 0) {
        currentMonth = 11;
        currentYear--;
    }

    ensureCurrentMonth();

    updateMonthHeader();

    renderAll();
}


function openMonthPicker() {
    const modal = $("monthModal");

    if (!modal) {
        return;
    }

    renderMonthPicker();

    openModal("monthModal");
}


function renderMonthPicker() {
    const grid = $("monthPickerGrid");
    const yearElement = $("pickerYear");

    if (!grid) {
        return;
    }

    if (yearElement) {
        yearElement.textContent = currentYear;
    }

    grid.innerHTML = "";

    MONTH_NAMES.forEach((name, index) => {
        const button = document.createElement("button");

        button.type = "button";
        button.className = "month-option";

        if (index === currentMonth) {
            button.classList.add("selected");
        }

        button.textContent = name;

        button.addEventListener("click", () => {
            currentMonth = index;

            ensureCurrentMonth();

            updateMonthHeader();
            renderAll();

            closeModal("monthModal");
        });

        grid.appendChild(button);
    });
}


/* =========================================================
   PAGE NAVIGATION
========================================================= */

function openPage(pageId) {
    const pages = document.querySelectorAll(".page");

    pages.forEach((page) => {
        page.classList.remove("active");
    });

    const target = $(pageId);

    if (!target) {
        return;
    }

    target.classList.add("active");

    activePage = pageId;

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });

    renderAll();
}


function goBack(pageId) {
    openPage(pageId);
}


/* =========================================================
   PERSONAL EXPENSE CALCULATIONS
========================================================= */

/*
    Important:

    Fuel budget belongs to the CAR section.
    Home contribution belongs to HOME.
    Savings is not counted until the user specifies an amount.

    Therefore personal fixed expenses are:

    loan + mobile internet
*/

function getPersonalBasicTotal() {
    const settings = getSettings();

    return (
        numberValue(settings.loan) +
        numberValue(settings.mobileInternet)
    );
}


function getCustomPersonalTotal() {
    const month = getCurrentMonthData();

    return month.expenses.reduce(
        (total, expense) => {
            return total + numberValue(expense.amount);
        },
        0
    );
}


function getPersonalGrandTotal() {
    return (
        getPersonalBasicTotal() +
        getCustomPersonalTotal()
    );
}


/* =========================================================
   HOME CALCULATIONS
========================================================= */

function getHomeBudget() {
    const settings = getSettings();

    return (
        numberValue(settings.homeContribution) +
        numberValue(settings.norhanContribution)
    );
}


function getHomeBasicTotal() {
    const settings = getSettings();

    return (
        numberValue(settings.generator) +
        numberValue(settings.homeInternet) +
        numberValue(settings.rent)
    );
}


function getHomeOtherTotal() {
    const month = getCurrentMonthData();

    return month.homeExpenses.reduce(
        (total, expense) => {
            return total + numberValue(expense.amount);
        },
        0
    );
}


function getHomeRemaining() {
    return (
        getHomeBudget() -
        getHomeBasicTotal() -
        getHomeOtherTotal()
    );
}


/* =========================================================
   CAR CALCULATIONS
========================================================= */

function getCarBudget() {
    const settings = getSettings();

    return numberValue(settings.fuelBudget);
}


/*
    The fuel budget should only be reduced by FUEL expenses.

    Maintenance and oil are still recorded in the car history,
    but they do not reduce the monthly fuel budget.
*/

function getFuelSpentTotal() {
    const month = getCurrentMonthData();

    return month.carExpenses.reduce(
        (total, expense) => {
            if (expense.type !== "fuel") {
                return total;
            }

            return total + numberValue(expense.amount);
        },
        0
    );
}


function getCarSpentTotal() {
    return getFuelSpentTotal();
}


function getCarRemaining() {
    return getCarBudget() - getFuelSpentTotal();
}


/* =========================================================
   RENDER
========================================================= */

function renderAll() {
    updateMonthHeader();

    renderPersonalExpenses();
    renderCar();
    renderHomeExpenses();

    renderSettingsValues();

    renderPersonalExpenseList();
    renderCarExpenseList();
    renderHomeExpenseList();
}


/* =========================================================
   PERSONAL EXPENSES RENDER
========================================================= */

function renderPersonalExpenses() {
    const settings = getSettings();

    const basicTotal = getPersonalBasicTotal();
    const otherTotal = getCustomPersonalTotal();
    const grandTotal = basicTotal + otherTotal;

    setText(
        "basicLoanValue",
        currency(settings.loan)
    );

    setText(
        "basicMobileInternetValue",
        currency(settings.mobileInternet)
    );

    setText(
        "basicHomeContributionValue",
        currency(settings.homeContribution)
    );

    setText(
        "basicSavingsValue",
        settings.savings === null ||
        settings.savings === undefined
            ? "غير محدد"
            : currency(settings.savings)
    );

    setText(
        "fuelBudgetInfo",
        currency(settings.fuelBudget)
    );

    setText(
        "fixedExpenseTotal",
        currency(basicTotal)
    );

    setText(
        "otherExpenseTotal",
        currency(otherTotal)
    );

    setText(
        "grandExpenseTotal",
        currency(grandTotal)
    );
}


/* =========================================================
   CAR RENDER
========================================================= */

function renderCar() {
    const budget = getCarBudget();
    const spent = getFuelSpentTotal();
    const remaining = budget - spent;

    setText(
        "carBudgetValue",
        currency(budget)
    );

    setText(
        "carSpentValue",
        currency(spent)
    );

    setText(
        "carRemainingValue",
        currency(remaining)
    );

    const progress = $("carBudgetProgress");

    if (progress) {
        let percentage = 0;

        if (budget > 0) {
            percentage = (spent / budget) * 100;
        }

        percentage = Math.max(
            0,
            Math.min(100, percentage)
        );

        progress.style.width = `${percentage}%`;
    }
}


/* =========================================================
   HOME RENDER
========================================================= */

function renderHomeExpenses() {
    const settings = getSettings();

    const budget = getHomeBudget();
    const basic = getHomeBasicTotal();
    const other = getHomeOtherTotal();
    const remaining = budget - basic - other;

    setText(
        "homeBudgetValue",
        currency(budget)
    );

    setText(
        "userHomeContribution",
        currency(settings.homeContribution)
    );

    setText(
        "norhanContribution",
        currency(settings.norhanContribution)
    );

    setText(
        "homeGeneratorValue",
        currency(settings.generator)
    );

    setText(
        "homeInternetValue",
        currency(settings.homeInternet)
    );

    setText(
        "homeRentValue",
        currency(settings.rent)
    );

    setText(
        "homeSummaryBudget",
        currency(budget)
    );

    setText(
        "homeBasicTotal",
        currency(basic)
    );

    setText(
        "homeOtherTotal",
        currency(other)
    );

    setText(
        "homeRemaining",
        currency(remaining)
    );
}


/* =========================================================
   SETTINGS RENDER
========================================================= */

function renderSettingsValues() {
    const settings = getSettings();

    setInputValue(
        "settingLoan",
        settings.loan
    );

    setInputValue(
        "settingFuelBudget",
        settings.fuelBudget
    );

    setInputValue(
        "settingMobileInternet",
        settings.mobileInternet
    );

    setInputValue(
        "settingHomeContribution",
        settings.homeContribution
    );

    setInputValue(
        "settingNorhanContribution",
        settings.norhanContribution
    );

    setInputValue(
        "settingGenerator",
        settings.generator
    );

    setInputValue(
        "settingHomeInternet",
        settings.homeInternet
    );

    setInputValue(
        "settingRent",
        settings.rent
    );
}


function setInputValue(id, value) {
    const input = $(id);

    if (input) {
        input.value = numberValue(value);
    }
}


/* =========================================================
   PERSONAL EXPENSE LIST
========================================================= */

function renderPersonalExpenseList() {
    const container = $("personalExpensesList");

    if (!container) {
        return;
    }

    const expenses = getCurrentMonthData().expenses;

    container.innerHTML = "";

    if (expenses.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                لا توجد مصاريف أخرى لهذا الشهر.
            </div>
        `;

        return;
    }

    expenses.forEach((expense) => {
        container.appendChild(
            createExpenseElement(
                expense,
                "personal"
            )
        );
    });
}


/* =========================================================
   CAR EXPENSE LIST
========================================================= */

function renderCarExpenseList() {
    const container = $("carExpensesList");

    if (!container) {
        return;
    }

    const expenses = getCurrentMonthData().carExpenses;

    container.innerHTML = "";

    if (expenses.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                لا توجد مصاريف سيارة لهذا الشهر.
            </div>
        `;

        return;
    }

    const sorted = [...expenses].sort(
        (a, b) => {
            return String(b.date || "").localeCompare(
                String(a.date || "")
            );
        }
    );

    sorted.forEach((expense) => {
        container.appendChild(
            createExpenseElement(
                expense,
                "car"
            )
        );
    });
}


/* =========================================================
   HOME EXPENSE LIST
========================================================= */

function renderHomeExpenseList() {
    const container = $("homeExpensesList");

    if (!container) {
        return;
    }

    const expenses = getCurrentMonthData().homeExpenses;

    container.innerHTML = "";

    if (expenses.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                لا توجد مصاريف بيت أخرى لهذا الشهر.
            </div>
        `;

        return;
    }

    const sorted = [...expenses].sort(
        (a, b) => {
            return String(b.date || "").localeCompare(
                String(a.date || "")
            );
        }
    );

    sorted.forEach((expense) => {
        container.appendChild(
            createExpenseElement(
                expense,
                "home"
            )
        );
    });
}


/* =========================================================
   CREATE EXPENSE ELEMENT
========================================================= */

function createExpenseElement(expense, category) {
    const wrapper = document.createElement("div");

    wrapper.className = "custom-expense";

    const dateText = formatDate(expense.date);

    let typeText = "";

    if (category === "car") {
        if (expense.type === "fuel") {
            typeText = "بانزين";
        } else if (expense.type === "oil") {
            typeText = "زيت";
        } else if (expense.type === "maintenance") {
            typeText = "صيانة";
        } else {
            typeText = "سيارة";
        }
    } else if (category === "home") {
        typeText = "مصروف بيت";
    } else {
        typeText = "مصروف شخصي";
    }

    wrapper.innerHTML = `
        <div class="custom-expense-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 4h12v16H6z"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.7"
                      stroke-linejoin="round"/>
                <path d="M9 8h6M9 12h6M9 16h4"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.7"
                      stroke-linecap="round"/>
            </svg>
        </div>

        <div class="custom-expense-info">
            <strong>${escapeHtml(expense.name || typeText)}</strong>
            <span>${typeText}${dateText ? ` • ${dateText}` : ""}${expense.note ? ` • ${escapeHtml(expense.note)}` : ""}</span>
        </div>

        <strong class="custom-expense-amount">
            ${currency(expense.amount)}
        </strong>

        <button
            type="button"
            class="delete-expense"
            aria-label="حذف ${escapeHtml(expense.name || typeText)}">
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 7h14M10 11v6M14 11v6M8 7l1-3h6l1 3M7 7l1 14h8l1-14"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.7"
                      stroke-linecap="round"
                      stroke-linejoin="round"/>
            </svg>
        </button>
    `;

    const deleteButton =
        wrapper.querySelector(".delete-expense");

    deleteButton.addEventListener("click", () => {
        deleteExpense(
            expense.id,
            category
        );
    });

    return wrapper;
}


/* =========================================================
   ADD PERSONAL EXPENSE
========================================================= */

function openPersonalExpenseModal() {
    setText(
        "expenseModalTitle",
        "مصروف شخصي جديد"
    );

    $("expenseType").value = "personal";

    $("expenseName").value = "";
    $("expenseAmount").value = "";
    $("expenseNote").value = "";

    setTodayIfEmpty("expenseDate");

    openModal("expenseModal");
}


/* =========================================================
   ADD HOME EXPENSE
========================================================= */

function openHomeExpenseModal() {
    setText(
        "expenseModalTitle",
        "مصروف بيت جديد"
    );

    $("expenseType").value = "home";

    $("expenseName").value = "";
    $("expenseAmount").value = "";
    $("expenseNote").value = "";

    setTodayIfEmpty("expenseDate");

    openModal("expenseModal");
}


/* =========================================================
   PERSONAL / HOME FORM
========================================================= */

function handleExpenseSubmit(event) {
    event.preventDefault();

    const name = $("expenseName").value.trim();

    const amount = numberValue(
        $("expenseAmount").value
    );

    const date = $("expenseDate").value;

    const note = $("expenseNote").value.trim();

    const type = $("expenseType").value;

    if (!name) {
        showToast("اكتب اسم المصروف");

        return;
    }

    if (amount <= 0) {
        showToast("أدخل مبلغاً صحيحاً");

        return;
    }

    const expense = {
        id: createId(),

        name,

        amount,

        date: date || getTodayDate(),

        note,

        createdAt: new Date().toISOString()
    };

    const month = getCurrentMonthData();

    if (type === "home") {
        month.homeExpenses.push(expense);
    } else {
        month.expenses.push(expense);
    }

    saveDatabase();

    closeModal("expenseModal");

    renderAll();

    showToast("تم حفظ المصروف");
}


/* =========================================================
   CAR FORM
========================================================= */

function openCarExpenseModal(type) {
    const titleMap = {
        fuel: "إضافة بانزين",
        maintenance: "إضافة صيانة",
        oil: "إضافة تغيير زيت"
    };

    const defaultNameMap = {
        fuel: "تعبئة بانزين",
        maintenance: "صيانة",
        oil: "تغيير زيت"
    };

    const selectedType = titleMap[type]
        ? type
        : "fuel";

    setText(
        "carExpenseModalTitle",
        titleMap[selectedType]
    );

    $("carExpenseType").value = selectedType;

    $("carExpenseName").value =
        defaultNameMap[selectedType];

    $("carExpenseAmount").value = "";

    $("carExpenseNote").value = "";

    setTodayIfEmpty("carExpenseDate");

    openModal("carExpenseModal");
}


function handleCarExpenseSubmit(event) {
    event.preventDefault();

    const name = $("carExpenseName").value.trim();

    const amount = numberValue(
        $("carExpenseAmount").value
    );

    const date = $("carExpenseDate").value;

    const note = $("carExpenseNote").value.trim();

    const type = $("carExpenseType").value;

    if (!name) {
        showToast("اكتب وصف المصروف");

        return;
    }

    if (amount <= 0) {
        showToast("أدخل مبلغاً صحيحاً");

        return;
    }

    const expense = {
        id: createId(),

        name,

        amount,

        date: date || getTodayDate(),

        note,

        type,

        createdAt: new Date().toISOString()
    };

    getCurrentMonthData().carExpenses.push(
        expense
    );

    saveDatabase();

    closeModal("carExpenseModal");

    renderAll();

    showToast("تم حفظ مصروف السيارة");
}


/* =========================================================
   DELETE EXPENSE
========================================================= */

function deleteExpense(id, category) {
    const confirmed = window.confirm(
        "هل تريد حذف هذا المصروف؟"
    );

    if (!confirmed) {
        return;
    }

    const month = getCurrentMonthData();

    if (category === "personal") {
        month.expenses =
            month.expenses.filter(
                (expense) => expense.id !== id
            );
    }

    if (category === "car") {
        month.carExpenses =
            month.carExpenses.filter(
                (expense) => expense.id !== id
            );
    }

    if (category === "home") {
        month.homeExpenses =
            month.homeExpenses.filter(
                (expense) => expense.id !== id
            );
    }

    saveDatabase();

    renderAll();

    showToast("تم حذف المصروف");
}


/* =========================================================
   BASIC SETTINGS
========================================================= */

function openSettingsModal() {
    renderSettingsValues();

    openModal("settingsModal");
}


function handleSettingsSubmit(event) {
    event.preventDefault();

    const settings = getSettings();

    settings.loan = numberValue(
        $("settingLoan").value
    );

    settings.fuelBudget = numberValue(
        $("settingFuelBudget").value
    );

    settings.mobileInternet = numberValue(
        $("settingMobileInternet").value
    );

    settings.homeContribution = numberValue(
        $("settingHomeContribution").value
    );

    settings.norhanContribution = numberValue(
        $("settingNorhanContribution").value
    );

    settings.generator = numberValue(
        $("settingGenerator").value
    );

    settings.homeInternet = numberValue(
        $("settingHomeInternet").value
    );

    settings.rent = numberValue(
        $("settingRent").value
    );

    saveDatabase();

    closeModal("settingsModal");

    renderAll();

    showToast("تم حفظ المصروفات الأساسية");
}


/* =========================================================
   HOME BASIC SETTINGS
========================================================= */

function openHomeBasicSettings() {
    renderSettingsValues();

    openModal("settingsModal");
}


/* =========================================================
   MODALS
========================================================= */

function openModal(id) {
    const modal = $(id);

    if (!modal) {
        return;
    }

    modal.classList.add("open");
    modal.setAttribute(
        "aria-hidden",
        "false"
    );

    document.body.style.overflow = "hidden";
}


function closeModal(id) {
    const modal = $(id);

    if (!modal) {
        return;
    }

    modal.classList.remove("open");

    modal.setAttribute(
        "aria-hidden",
        "true"
    );

    const anyOpenModal =
        document.querySelector(
            ".modal-backdrop.open"
        );

    if (!anyOpenModal) {
        document.body.style.overflow = "";
    }
}


function closeAllModals() {
    document
        .querySelectorAll(".modal-backdrop.open")
        .forEach((modal) => {
            modal.classList.remove("open");

            modal.setAttribute(
                "aria-hidden",
                "true"
            );
        });

    document.body.style.overflow = "";
}


/* =========================================================
   THEME
========================================================= */

function loadTheme() {
    try {
        const theme =
            localStorage.getItem(
                "daftari_theme"
            );

        if (theme === "dark") {
            document.body.classList.add("dark");
        }
    } catch (error) {
        console.warn("Theme storage unavailable");
    }
}


function toggleTheme() {
    document.body.classList.toggle("dark");

    try {
        localStorage.setItem(
            "daftari_theme",
            document.body.classList.contains("dark")
                ? "dark"
                : "light"
        );
    } catch (error) {
        console.warn("Theme storage unavailable");
    }
}


/* =========================================================
   DATE HELPERS
========================================================= */

function getTodayDate() {
    const date = new Date();

    const year = date.getFullYear();

    const month = String(
        date.getMonth() + 1
    ).padStart(2, "0");

    const day = String(
        date.getDate()
    ).padStart(2, "0");

    return `${year}-${month}-${day}`;
}


function setTodayIfEmpty(id) {
    const input = $(id);

    if (!input) {
        return;
    }

    if (!input.value) {
        input.value = getTodayDate();
    }
}


function formatDate(dateString) {
    if (!dateString) {
        return "";
    }

    const parts = String(
        dateString
    ).split("-");

    if (parts.length !== 3) {
        return dateString;
    }

    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}


/* =========================================================
   ID
========================================================= */

function createId() {
    return (
        Date.now().toString(36) +
        Math.random()
            .toString(36)
            .slice(2, 8)
    );
}


/* =========================================================
   HTML SAFETY
========================================================= */

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


/* =========================================================
   TOAST
========================================================= */

function showToast(message) {
    const toast = $("toast");

    if (!toast) {
        return;
    }

    toast.textContent = message;

    toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 2200);
}


/* =========================================================
   EVENT LISTENERS
========================================================= */

function setupNavigation() {

    document
        .querySelectorAll("[data-open-page]")
        .forEach((button) => {

            button.addEventListener(
                "click",
                () => {

                    openPage(
                        button.dataset.openPage
                    );

                }
            );

        });


    document
        .querySelectorAll("[data-back]")
        .forEach((button) => {

            button.addEventListener(
                "click",
                () => {

                    goBack(
                        button.dataset.back
                    );

                }
            );

        });
}


function setupMonthNavigation() {

    $("prevMonth")?.addEventListener(
        "click",
        () => {
            changeMonth(-1);
        }
    );

    $("nextMonth")?.addEventListener(
        "click",
        () => {
            changeMonth(1);
        }
    );

    $("monthPickerButton")?.addEventListener(
        "click",
        openMonthPicker
    );

    $("prevYear")?.addEventListener(
        "click",
        () => {

            currentYear--;

            ensureCurrentMonth();

            renderMonthPicker();
            updateMonthHeader();
            renderAll();

        }
    );

    $("nextYear")?.addEventListener(
        "click",
        () => {

            currentYear++;

            ensureCurrentMonth();

            renderMonthPicker();
            updateMonthHeader();
            renderAll();

        }
    );
}


function setupModals() {

    document
        .querySelectorAll("[data-close-modal]")
        .forEach((button) => {

            button.addEventListener(
                "click",
                () => {

                    closeModal(
                        button.dataset.closeModal
                    );

                }
            );

        });


    document
        .querySelectorAll(".modal-backdrop")
        .forEach((modal) => {

            modal.addEventListener(
                "click",
                (event) => {

                    if (
                        event.target === modal
                    ) {
                        closeModal(
                            modal.id
                        );
                    }

                }
            );

        });


    document.addEventListener(
        "keydown",
        (event) => {

            if (event.key === "Escape") {
                closeAllModals();
            }

        }
    );
}


function setupForms() {

    $("expenseForm")?.addEventListener(
        "submit",
        handleExpenseSubmit
    );

    $("carExpenseForm")?.addEventListener(
        "submit",
        handleCarExpenseSubmit
    );

    $("settingsForm")?.addEventListener(
        "submit",
        handleSettingsSubmit
    );
}


function setupActions() {

    $("themeToggle")?.addEventListener(
        "click",
        toggleTheme
    );

    $("addPersonalExpense")?.addEventListener(
        "click",
        openPersonalExpenseModal
    );

    $("addHomeExpense")?.addEventListener(
        "click",
        openHomeExpenseModal
    );

    $("addFuelExpense")?.addEventListener(
        "click",
        () => {
            openCarExpenseModal("fuel");
        }
    );

    $("addMaintenanceExpense")?.addEventListener(
        "click",
        () => {
            openCarExpenseModal("maintenance");
        }
    );

    $("addOilExpense")?.addEventListener(
        "click",
        () => {
            openCarExpenseModal("oil");
        }
    );

    $("editBasicExpenses")?.addEventListener(
        "click",
        openSettingsModal
    );

    $("editHomeBasicExpenses")?.addEventListener(
        "click",
        openHomeBasicSettings
    );
}


/* =========================================================
   INIT
========================================================= */

function init() {
    ensureCurrentMonth();

    loadTheme();

    updateMonthHeader();

    setupNavigation();

    setupMonthNavigation();

    setupModals();

    setupForms();

    setupActions();

    renderAll();
}


init();