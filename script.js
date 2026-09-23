/* =========================================================
   DAFTARI
   Local-only personal life organizer
   Rewritten to match the current index.html structure
========================================================= */

"use strict";

/* =========================================================
   STORAGE
========================================================= */

const STORAGE_KEY = "daftari_v2";
const THEME_KEY = "daftari_theme";

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

const WEEKDAY_NAMES = [
    "الأحد",
    "الإثنين",
    "الثلاثاء",
    "الأربعاء",
    "الخميس",
    "الجمعة",
    "السبت"
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

function formatNumber(value) {
    const number = Number(value) || 0;

    return number.toLocaleString("en-US");
}

function currency(value) {
    return `${formatNumber(value)} د.ع`;
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
   DATABASE
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

function loadDatabase() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);

        if (!saved) {
            return { months: {} };
        }

        const database = JSON.parse(saved);

        if (!database || typeof database !== "object") {
            return { months: {} };
        }

        if (!database.months || typeof database.months !== "object") {
            database.months = {};
        }

        return database;

    } catch (error) {
        console.error("Daftari storage error:", error);

        return { months: {} };
    }
}

function saveDatabase() {
    try {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(database)
        );

    } catch (error) {
        console.error("Daftari save error:", error);
    }
}

let database = loadDatabase();

function ensureCurrentMonth() {
    const key = monthKey();

    if (!database.months[key]) {
        database.months[key] = createMonth(currentYear, currentMonth);
    }

    const month = database.months[key];

    month.year = currentYear;
    month.month = currentMonth;

    month.settings = {
        ...DEFAULT_MONTH_SETTINGS,
        ...(month.settings || {})
    };

    if (!Array.isArray(month.expenses)) {
        month.expenses = [];
    }

    if (!Array.isArray(month.carExpenses)) {
        month.carExpenses = [];
    }

    if (!Array.isArray(month.homeExpenses)) {
        month.homeExpenses = [];
    }

    return month;
}

function currentMonthData() {
    return ensureCurrentMonth();
}

function commit() {
    saveDatabase();
    renderAll();
}

/* =========================================================
   THEME
========================================================= */

function applyTheme(theme) {
    document.body.classList.toggle(
        "dark",
        theme === "dark"
    );

    const button = $("themeButton");

    if (button) {
        button.textContent = theme === "dark" ? "☀" : "☾";
    }
}

function loadTheme() {
    let theme = "light";

    try {
        theme = localStorage.getItem(THEME_KEY) || "light";

    } catch (error) {
        console.error("Daftari theme error:", error);
    }

    applyTheme(theme);
}

function toggleTheme() {
    const isDark = document.body.classList.contains("dark");

    const theme = isDark ? "light" : "dark";

    applyTheme(theme);

    try {
        localStorage.setItem(THEME_KEY, theme);

    } catch (error) {
        console.error("Daftari theme save error:", error);
    }
}

/* =========================================================
   HEADER / MONTH NAVIGATION
========================================================= */

function updateMonthHeader() {
    const dateText =
        `${WEEKDAY_NAMES[now.getDay()]} ` +
        `${now.getDate()} ${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;

    setText("currentDate", dateText);
    setText("monthName", `${MONTH_NAMES[currentMonth]} ${currentYear}`);

    updateMonthLock();
}

/* =========================================================
   MONTH LOCK
   Previous months become read-only.
   Records can be edited/deleted only via long-press (~2s).
========================================================= */

const LONG_PRESS_DURATION = 2000;

/*
    Central month-lock state - compares YEAR + MONTH against today:

        past months    (before today's year/month) -> CLOSED (true)
        current month                             -> OPEN   (false)
        future months                             -> OPEN   (false)

    Example (today = 23/09/2026):
        Jan 2026 .. Aug 2026 -> closed
        Sep 2026             -> open
        Oct 2026 .. Dec 2026 -> open
        Jan 2027             -> open

    This is the single source of truth used by every lock check.
*/
function isMonthClosed(year = currentYear, month = currentMonth) {
    const today = new Date();

    return (
        year < today.getFullYear() ||
        (year === today.getFullYear() && month < today.getMonth())
    );
}

function updateMonthLock() {
    const lock = $("monthLock");

    if (!lock) {
        return;
    }

    lock.classList.toggle(
        "hidden",
        !isMonthClosed()
    );
}

/*
    Attaches long-press behavior to a rendered record row.

    - locked month  : normal click does nothing (with a hint toast);
                      press-and-hold ~2s shows a visual progress and
                      then opens the action sheet (edit / delete).
    - current month : single click triggers the action directly.
*/
function attachRecordPress(row, onAction) {
    if (!row) {
        return;
    }

    if (!isMonthClosed()) {
        row.addEventListener("click", onAction);
        return;
    }

    row.classList.add("locked-record");

    let pressTimer = null;
    let longPressDone = false;
    let startX = 0;
    let startY = 0;

    const clearProgress = () => {
        row.classList.remove("long-pressing");
    };

    const cancelPress = () => {

        if (longPressDone) {
            return;
        }

        clearTimeout(pressTimer);
        pressTimer = null;
        clearProgress();

    };

    row.addEventListener(
        "pointerdown",
        (event) => {

            if (event.button && event.button !== 0) {
                return;
            }

            longPressDone = false;

            startX = event.clientX;
            startY = event.clientY;

            clearProgress();

            row.classList.add("long-pressing");

            pressTimer = setTimeout(
                () => {

                    pressTimer = null;

                    longPressDone = true;

                    clearProgress();

                    onAction();

                },
                LONG_PRESS_DURATION
            );

        }
    );

    row.addEventListener(
        "pointermove",
        (event) => {

            if (!pressTimer) {
                return;
            }

            const moved =
                Math.abs(event.clientX - startX) > 12 ||
                Math.abs(event.clientY - startY) > 12;

            if (moved) {
                cancelPress();
            }

        }
    );

    row.addEventListener("pointerup", cancelPress);
    row.addEventListener("pointercancel", cancelPress);
    row.addEventListener("pointerleave", cancelPress);

    row.addEventListener(
        "click",
        (event) => {

            event.preventDefault();
            event.stopImmediatePropagation();

            if (longPressDone) {
                longPressDone = false;
                return;
            }

            showToast("🔒 شهر مغلق — اضغط مطولاً على العملية للتعديل");

        }
    );
}

function setupMonthNavigation() {
    $("previousMonth")?.addEventListener(
        "click",
        () => {

            currentMonth--;

            if (currentMonth < 0) {
                currentMonth = 11;
                currentYear--;
            }

            ensureCurrentMonth();
            updateMonthHeader();
            renderAll();

        }
    );

    $("nextMonth")?.addEventListener(
        "click",
        () => {

            currentMonth++;

            if (currentMonth > 11) {
                currentMonth = 0;
                currentYear++;
            }

            ensureCurrentMonth();
            updateMonthHeader();
            renderAll();

        }
    );
}

/* =========================================================
   NAVIGATION
========================================================= */

function showPage(pageId) {
    activePage = pageId;

    document
        .querySelectorAll(".page")
        .forEach((page) => {

            page.classList.toggle(
                "active",
                page.id === pageId
            );

        });

    document
        .querySelectorAll(".nav-item")
        .forEach((item) => {

            item.classList.toggle(
                "active",
                item.dataset.page === pageId
            );

        });

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}

function setupNavigation() {
    document
        .querySelectorAll("[data-page]")
        .forEach((button) => {

            button.addEventListener(
                "click",
                () => {
                    showPage(button.dataset.page);
                }
            );

        });
}

/* =========================================================
   MODAL / TOAST
========================================================= */

function openModal(html) {
    const modal = $("modal");
    const content = $("modalContent");

    if (!modal || !content) {
        return;
    }

    content.innerHTML = html;

    modal.classList.remove("hidden");
}

function closeModal() {
    $("modal")?.classList.add("hidden");
}

function setupModal() {
    $("modalClose")?.addEventListener("click", closeModal);

    $("modalOverlay")?.addEventListener("click", closeModal);

    document.addEventListener(
        "keydown",
        (event) => {

            if (event.key === "Escape") {
                closeModal();
            }

        }
    );
}

function showToast(message) {
    const toast = $("toast");

    if (!toast) {
        return;
    }

    toast.textContent = message;

    toast.classList.remove("hidden");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(
        () => {
            toast.classList.add("hidden");
        },
        2600
    );
}

/* =========================================================
   MODAL FORM TEMPLATES
========================================================= */

function amountFormHtml({ title, label, value = "", submitLabel = "حفظ" }) {
    return `
        <h2 class="modal-title">${title}</h2>

        <form id="genericForm">

            <div class="form-group">

                <label for="genericAmount">
                    ${label}
                </label>

                <input
                    type="number"
                    id="genericAmount"
                    min="0"
                    step="1000"
                    inputmode="numeric"
                    value="${value}"
                    required
                >

            </div>

            <button
                type="submit"
                class="form-submit"
            >
                ${submitLabel}
            </button>

        </form>
    `;
}

function expenseFormHtml({ title, label, withSavingsOption = false }) {
    return `
        <h2 class="modal-title">${title}</h2>

        <form id="genericForm">

            <div class="form-group">

                <label for="genericTitle">
                    ${label}
                </label>

                <input
                    type="text"
                    id="genericTitle"
                    placeholder="مثال: مصروف الطريق"
                    required
                >

            </div>

            <div class="form-group">

                <label for="genericAmount">
                    المبلغ (د.ع)
                </label>

                <input
                    type="number"
                    id="genericAmount"
                    min="0"
                    step="250"
                    inputmode="numeric"
                    required
                >

            </div>

            ${withSavingsOption ? `
            <div class="form-group savings-choice">

                <label class="choice-label">
                    <input
                        type="checkbox"
                        id="genericIsSavings"
                    >

                    <span>
                        💰 هذا المبلغ ادخار (يُضاف إلى رصيد الادخار)
                    </span>

                </label>

            </div>
            ` : ""}

            <button
                type="submit"
                class="form-submit"
            >
                حفظ
            </button>

        </form>
    `;
}

function bindGenericForm(onSubmit) {
    const form = $("genericForm");

    if (!form) {
        return;
    }

    form.addEventListener(
        "submit",
        (event) => {

            event.preventDefault();

            const amount = numberValue($("genericAmount")?.value);

            if (amount <= 0) {
                showToast("أدخل مبلغاً صحيحاً");
                return;
            }

            const title = $("genericTitle")?.value?.trim() || "";

            onSubmit(amount, title);

        }
    );
}

/* =========================================================
   ACTIONS (edit settings / savings / add expenses)
========================================================= */

const EDITABLE_SETTINGS = {
    loan: "السلفة",
    fuelBudget: "ميزانية البنزين",
    mobileInternet: "نت الموبايل",
    homeContribution: "مصرف البيت",
    generator: "المولد",
    homeInternet: "نت البيت",
    rent: "الإيجار"
};

function openEditSettingModal(key) {
    const month = currentMonthData();

    const label = EDITABLE_SETTINGS[key];

    if (!label) {
        return;
    }

    openModal(
        amountFormHtml({
            title: `تعديل ${label}`,
            label: `${label} (د.ع)`,
            value: numberValue(month.settings[key])
        })
    );

    bindGenericForm(
        (amount) => {

            month.settings[key] = amount;

            commit();
            closeModal();
            showToast("تم الحفظ");

        }
    );
}

function openSavingModal() {
    const month = currentMonthData();

    openModal(
        amountFormHtml({
            title: "تحديد الادخار",
            label: "مبلغ الادخار (د.ع)",
            value: month.savings ? numberValue(month.savings) : ""
        })
    );

    bindGenericForm(
        (amount) => {

            month.savings = amount;

            commit();
            closeModal();
            showToast("تم حفظ الادخار");

        }
    );
}

function openPersonalExpenseModal() {
    openModal(
        expenseFormHtml({
            title: "إضافة مصروف",
            label: "اسم المصروف",
            withSavingsOption: true
        })
    );

    bindGenericForm(
        (amount, title) => {

            const month = currentMonthData();

            const isSavings =
                $("genericIsSavings")?.checked === true;

            month.expenses.push({
                id: Date.now(),
                title: title || "مصروف",
                amount,
                isSavings,
                date: new Date().toISOString()
            });

            if (isSavings) {
                addSavingsTransaction({
                    type: "fromExpenses",
                    amount,
                    note: title || "مصروف محوّل لادخار"
                });
            }

            commit();
            closeModal();
            showToast(
                isSavings ? "تمت الإضافة وتحويلها للادخار" : "تمت إضافة المصروف"
            );

        }
    );
}

function openHomeExpenseModal() {
    openModal(
        expenseFormHtml({
            title: "إضافة مصروف بيت",
            label: "اسم المصروف"
        })
    );

    bindGenericForm(
        (amount, title) => {

            const month = currentMonthData();

            month.homeExpenses.push({
                id: Date.now(),
                title: title || "مصروف بيت",
                amount,
                date: new Date().toISOString()
            });

            commit();
            closeModal();
            showToast("تمت إضافة المصروف");

        }
    );
}

function openCarExpenseModal(kind) {
    const titles = {
        fuel: "بنزين",
        maintenance: "صيانة",
        oil: "زيت"
    };

    const label = titles[kind] || "مصروف سيارة";

    openModal(
        expenseFormHtml({
            title: `إضافة ${label}`,
            label: "الوصف (اختياري)"
        })
    );

    bindGenericForm(
        (amount, title) => {

            const month = currentMonthData();

            month.carExpenses.push({
                id: Date.now(),
                kind,
                title: title || label,
                amount,
                date: new Date().toISOString()
            });

            commit();
            closeModal();
            showToast(`تمت إضافة ${label}`);

        }
    );
}

function setupActions() {
    $("themeButton")?.addEventListener("click", toggleTheme);

    $("setSavingButton")?.addEventListener("click", openSavingModal);

    $("addExpenseButton")?.addEventListener("click", openPersonalExpenseModal);

    $("addHomeExpenseButton")?.addEventListener("click", openHomeExpenseModal);

    $("carFuelButton")?.addEventListener(
        "click",
        () => openCarExpenseModal("fuel")
    );

    $("carMaintenanceButton")?.addEventListener(
        "click",
        () => openCarExpenseModal("maintenance")
    );

    $("carOilButton")?.addEventListener(
        "click",
        () => openCarExpenseModal("oil")
    );

    $("savingsDepositButton")?.addEventListener(
        "click",
        openDepositModal
    );

    $("savingsWithdrawButton")?.addEventListener(
        "click",
        openWithdrawModal
    );

    $("addDebtorButton")?.addEventListener(
        "click",
        openAddDebtorModal
    );

    $("addPersonalTaskButton")?.addEventListener(
        "click",
        () => openAddTaskModal("personalTasks", "إضافة مهمة شخصية")
    );

    $("addHomeTaskButton")?.addEventListener(
        "click",
        () => openAddTaskModal("homeTasks", "إضافة مهمة بيت")
    );

    document
        .querySelectorAll("[data-edit-setting]")
        .forEach((button) => {

            button.addEventListener(
                "click",
                () => {
                    openEditSettingModal(button.dataset.editSetting);
                }
            );

        });

    document.addEventListener(
        "click",
        (event) => {

            const deleteButton = event.target.closest("[data-delete]");

            if (deleteButton) {
                deleteRecord(
                    deleteButton.dataset.delete,
                    deleteButton.dataset.deleteId
                );
                return;
            }

            const payButton = event.target.closest("[data-debtor-pay]");

            if (payButton) {
                openDebtorPaymentModal(payButton.dataset.debtorPay);
                return;
            }

            const debtorDeleteButton =
                event.target.closest("[data-debtor-delete]");

            if (debtorDeleteButton) {
                deleteDebtor(debtorDeleteButton.dataset.debtorDelete);
                return;
            }

            const taskToggleButton =
                event.target.closest("[data-task-toggle]");

            if (taskToggleButton) {
                toggleTask(taskToggleButton.dataset.taskToggle);
                return;
            }

            const taskDeleteButton =
                event.target.closest("[data-task-delete]");

            if (taskDeleteButton) {
                deleteTask(taskDeleteButton.dataset.taskDelete);
            }

        }
    );
}

function deleteRecord(listName, recordId, force = false) {
    const month = currentMonthData();

    if (
        !force &&
        isMonthClosed(month.year, month.month)
    ) {
        showToast("🔒 شهر مغلق — استخدم الضغط المطول");
        return;
    }

    const id = Number(recordId);

    month[listName] = month[listName].filter(
        (record) => record.id !== id
    );

    commit();
    showToast("تم الحذف");
}

/*
    After rendering record rows into a list container, this wires
    every row:

    - current month : delete button works normally.
    - locked month  : delete button is blocked; long-press (~2s)
                      on the row opens an action sheet that allows
                      deleting the record (bypasses the lock).
*/
function wireRecordRows(listElement, listName) {
    if (!listElement) {
        return;
    }

    if (!isMonthClosed()) {
        return;
    }

    Array.from(listElement.children).forEach((row) => {

        const deleteButton = row.querySelector("[data-delete]");

        if (!deleteButton) {
            return;
        }

        const recordId = deleteButton.dataset.deleteId;

        deleteButton.addEventListener(
            "click",
            (event) => {

                event.preventDefault();
                event.stopImmediatePropagation();

                showToast("🔒 شهر مغلق — اضغط مطولاً على العملية");

            },
            true
        );

        attachRecordPress(
            row,
            () => {

                openModal(
                    `
                    <h2 class="modal-title">تعديل عملية شهر مغلق</h2>

                    <p class="locked-hint">
                        🔒 هذا الشهر مغلق. يمكنك حذف هذه العملية فقط.
                    </p>

                    <button
                        type="button"
                        class="form-submit danger"
                        id="forceDeleteButton"
                    >
                        حذف العملية
                    </button>
                    `
                );

                $("forceDeleteButton")?.addEventListener(
                    "click",
                    () => {

                        closeModal();

                        deleteRecord(listName, recordId, true);

                    }
                );

            }
        );

    });
}

/* =========================================================
   SAVINGS & DEBTORS (permanent, same storage system)

   IMPORTANT: savings are a CONTINUOUS CUMULATIVE balance
   across ALL months, stored once at database level
   (database.savingsLedger). Months never reset it.

   Old per-month data (month.savingsAccount) is migrated
   automatically on load - nothing is deleted.
========================================================= */

/*
    Migrates old per-month savings accounts into the single
    cumulative ledger. Keeps original transaction dates.
*/
function migrateSavingsLedger() {

    if (!database.savingsLedger || typeof database.savingsLedger !== "object") {
        database.savingsLedger = {
            transactions: [],
            debtors: []
        };
    }

    if (!Array.isArray(database.savingsLedger.transactions)) {
        database.savingsLedger.transactions = [];
    }

    if (!Array.isArray(database.savingsLedger.debtors)) {
        database.savingsLedger.debtors = [];
    }

    Object.keys(database.months).forEach((key) => {

        const month = database.months[key];

        if (!month || typeof month !== "object") {
            return;
        }

        // Migrate old simple monthly savings value (month.savings)

        if (month.savings !== null && month.savings !== undefined) {

            const value = numberValue(month.savings);

            if (value > 0) {
                database.savingsLedger.transactions.push({
                    id: Date.now() + Math.floor(Math.random() * 100000),
                    type: "deposit",
                    amount: value,
                    note: "رصيد قديم (ترحيل تلقائي)",
                    date: new Date(
                        month.year,
                        month.month,
                        1,
                        12
                    ).toISOString()
                });
            }

            month.savings = null;

        }

        // Migrate old per-month savings account

        const account = month.savingsAccount;

        if (account && typeof account === "object") {

            if (Array.isArray(account.transactions)) {
                database.savingsLedger.transactions.push(
                    ...account.transactions
                );
            }

            if (Array.isArray(ledger.debtors)) {
                database.savingsLedger.debtors.push(
                    ...ledger.debtors
                );
            }

            delete month.savingsAccount;

        }

    });

    // Deduplicate by id (safe against repeated migrations)

    const seen = new Set();

    database.savingsLedger.transactions =
        database.savingsLedger.transactions.filter((transaction) => {

            if (!transaction || seen.has(transaction.id)) {
                return false;
            }

            seen.add(transaction.id);

            return true;

        });

    const debtorIds = new Set();

    database.savingsLedger.debtors =
        database.savingsLedger.debtors.filter((debtor) => {

            if (!debtor || debtorIds.has(debtor.id)) {
                return false;
            }

            debtorIds.add(debtor.id);

            return true;

        });

}

function getSavingsLedger() {
    return database.savingsLedger;
}

function savingsStats() {
    const ledger = getSavingsLedger();

    let deposits = 0;
    let withdrawals = 0;
    let fromExpenses = 0;

    ledger.transactions.forEach((transaction) => {

        const amount = numberValue(transaction.amount);

        if (transaction.type === "deposit") {
            deposits += amount;
        }

        if (transaction.type === "withdraw") {
            withdrawals += amount;
        }

        if (transaction.type === "fromExpenses") {
            fromExpenses += amount;
        }

    });

    // Cumulative balance across ALL months since the beginning

    const balance = deposits + fromExpenses - withdrawals;

    const debts = ledger.debtors.reduce(
        (total, debtor) =>
            total +
            Math.max(
                numberValue(debtor.required) - numberValue(debtor.paid),
                0
            ),
        0
    );

    return {
        deposits,
        withdrawals,
        fromExpenses,
        balance,
        debts,
        grandTotal: balance + debts
    };
}

function addSavingsTransaction({ type, amount, note = "", date = null }) {
    const ledger = getSavingsLedger();

    ledger.transactions.push({
        id: Date.now() + Math.floor(Math.random() * 1000),
        type,
        amount: numberValue(amount),
        note,
        date: date || new Date().toISOString(),
        createdAt: new Date().toISOString()
    });
}

function getSavingsBalance() {
    return savingsStats().balance;
}

/*
    Monthly savings report: groups cumulative-ledger
    transactions by their transaction date's month.
    The balance stays cumulative - this is a filter only.
*/
function savingsMonthlyReport(year, month) {
    const ledger = getSavingsLedger();

    let deposits = 0;
    let withdrawals = 0;
    let fromExpenses = 0;

    ledger.transactions.forEach((transaction) => {

        const date = new Date(transaction.date);

        if (
            Number.isNaN(date.getTime()) ||
            date.getFullYear() !== year ||
            date.getMonth() !== month
        ) {
            return;
        }

        const amount = numberValue(transaction.amount);

        if (transaction.type === "deposit") {
            deposits += amount;
        }

        if (transaction.type === "withdraw") {
            withdrawals += amount;
        }

        if (transaction.type === "fromExpenses") {
            fromExpenses += amount;
        }

    });

    return {
        deposits,
        withdrawals,
        fromExpenses,
        net: deposits + fromExpenses - withdrawals
    };
}

/* =========================================================
   PAGE TABS
========================================================= */

function setupPageTabs() {
    document
        .querySelectorAll(".page-tab")
        .forEach((tab) => {

            tab.addEventListener(
                "click",
                () => {

                    const tabsContainer = tab.closest(".page-tabs");

                    if (!tabsContainer) {
                        return;
                    }

                    tabsContainer
                        .querySelectorAll(".page-tab")
                        .forEach((item) => {

                            item.classList.toggle(
                                "active",
                                item === tab
                            );

                        });

                    const page = tab.closest(".page");

                    if (!page) {
                        return;
                    }

                    page
                        .querySelectorAll(".tab-panel")
                        .forEach((panel) => {

                            panel.classList.toggle(
                                "active",
                                panel.id === tab.dataset.tab
                            );

                        });

                }
            );

        });
}

/* =========================================================
   TASKS (personal + home)
   Stored per month in the same database:
   month.tasks = [{ id, listKey, title, note, done, date }]
========================================================= */

function ensureTasks(month) {
    if (!Array.isArray(month.tasks)) {
        month.tasks = [];
    }

    return month.tasks;
}

function taskFormHtml({ title }) {
    return `
        <h2 class="modal-title">${title}</h2>

        <form id="genericForm">

            <div class="form-group">

                <label for="genericTitle">
                    نص المهمة
                </label>

                <input
                    type="text"
                    id="genericTitle"
                    placeholder="مثال: دفع فاتورة الكهرباء"
                    required
                >

            </div>

            <div class="form-group">

                <label for="genericNote">
                    ملاحظة (اختياري)
                </label>

                <input
                    type="text"
                    id="genericNote"
                    placeholder="ملاحظة..."
                >

            </div>

            <div class="form-group">

                <label for="genericDate">
                    التاريخ
                </label>

                <input
                    type="date"
                    id="genericDate"
                    required
                >

            </div>

            <button
                type="submit"
                class="form-submit"
            >
                حفظ
            </button>

        </form>
    `;
}

function openAddTaskModal(listKey, modalTitle) {
    openModal(
        taskFormHtml({
            title: modalTitle
        })
    );

    const form = $("genericForm");

    if (!form) {
        return;
    }

    form.addEventListener(
        "submit",
        (event) => {

            event.preventDefault();

            const title = $("genericTitle")?.value?.trim();

            if (!title) {
                showToast("أدخل نص المهمة");
                return;
            }

            const month = currentMonthData();

            const tasks = ensureTasks(month);

            tasks.push({
                id: Date.now(),
                listKey,
                title,
                note: getFormNote(),
                done: false,
                date: getFormDate()
            });

            commit();
            closeModal();
            showToast("تمت إضافة المهمة");

        }
    );
}

function toggleTask(taskId) {
    const month = currentMonthData();

    const tasks = ensureTasks(month);

    const task = tasks.find(
        (item) => item.id === Number(taskId)
    );

    if (!task) {
        return;
    }

    task.done = !task.done;

    commit();
}

function deleteTask(taskId, force = false) {
    const month = currentMonthData();

    if (
        !force &&
        isMonthClosed(month.year, month.month)
    ) {
        showToast("🔒 شهر مغلق — استخدم الضغط المطول");
        return;
    }

    const tasks = ensureTasks(month);

    month.tasks = tasks.filter(
        (item) => item.id !== Number(taskId)
    );

    commit();
    showToast("تم حذف المهمة");
}

function taskRowHtml(task) {
    return `
        <div class="record-row task-row ${task.done ? "task-done" : ""}">

            <button
                type="button"
                class="task-check"
                data-task-toggle="${task.id}"
                aria-label="إكمال"
            >
                ${task.done ? "✓" : ""}
            </button>

            <div class="record-info">

                <strong>
                    ${task.title}
                </strong>

                <span>
                    ${formatDate(task.date)}
                    ${task.note ? ` - ${task.note}` : ""}
                </span>

            </div>

            <button
                type="button"
                class="delete-record"
                data-task-delete="${task.id}"
                aria-label="حذف"
            >
                ×
            </button>

        </div>
    `;
}

function renderTaskList(listId, listKey) {
    const month = currentMonthData();

    const list = $(listId);

    if (!list) {
        return;
    }

    const tasks = ensureTasks(month).filter(
        (task) => task.listKey === listKey
    );

    if (!tasks.length) {
        list.innerHTML = emptyListHtml("لا توجد مهام بعد");
        return;
    }

    list.innerHTML = tasks
        .slice()
        .reverse()
        .map(taskRowHtml)
        .join("");

    if (isMonthClosed()) {
        Array.from(list.children).forEach((row) => {

            const taskId =
                row.querySelector("[data-task-delete]")?.dataset.taskDelete;

            if (!taskId) {
                return;
            }

            attachRecordPress(
                row,
                () => {

                    openModal(
                        `
                        <h2 class="modal-title">حذف مهمة شهر مغلق</h2>

                        <p class="locked-hint">
                            🔒 هذا الشهر مغلق. يمكنك حذف هذه المهمة فقط.
                        </p>

                        <button
                            type="button"
                            class="form-submit danger"
                            id="forceDeleteTaskButton"
                        >
                            حذف المهمة
                        </button>
                        `
                    );

                    $("forceDeleteTaskButton")?.addEventListener(
                        "click",
                        () => {

                            closeModal();

                            deleteTask(taskId, true);

                        }
                    );

                }
            );

        });
    }
}

function renderTasks() {
    renderTaskList("personalTasksList", "personalTasks");
    renderTaskList("homeTasksList", "homeTasks");
}

/* TASK RENDER APPEND */



function formatDate(iso) {
    const date = new Date(iso);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

/* --- SAVINGS MODALS --- */

function savingsTransactionFormHtml({ title, submitLabel }) {
    return `
        <h2 class="modal-title">${title}</h2>

        <form id="genericForm">

            <div class="form-group">

                <label for="genericAmount">
                    المبلغ (د.ع)
                </label>

                <input
                    type="number"
                    id="genericAmount"
                    min="0"
                    step="1000"
                    inputmode="numeric"
                    required
                >

            </div>

            <div class="form-group">

                <label for="genericDate">
                    التاريخ
                </label>

                <input
                    type="date"
                    id="genericDate"
                    required
                >

            </div>

            <div class="form-group">

                <label for="genericNote">
                    ملاحظة (اختياري)
                </label>

                <input
                    type="text"
                    id="genericNote"
                    placeholder="ملاحظة..."
                >

            </div>

            <button
                type="submit"
                class="form-submit"
            >
                ${submitLabel}
            </button>

        </form>
    `;
}

function getFormDate() {
    const value = $("genericDate")?.value;

    if (!value) {
        return new Date().toISOString();
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? new Date().toISOString()
        : date.toISOString();
}

function getFormNote() {
    return $("genericNote")?.value?.trim() || "";
}

function openDepositModal() {
    openModal(
        savingsTransactionFormHtml({
            title: "إيداع في الادخار",
            submitLabel: "إيداع"
        })
    );

    bindGenericForm(
        (amount) => {

            addSavingsTransaction({
                type: "deposit",
                amount,
                note: getFormNote(),
                date: getFormDate()
            });

            commit();
            closeModal();
            showToast("تم الإيداع");

        }
    );
}

function openWithdrawModal() {
    openModal(
        savingsTransactionFormHtml({
            title: "سحب من الادخار",
            submitLabel: "سحب"
        })
    );

    bindGenericForm(
        (amount) => {

            if (amount > getSavingsBalance()) {
                showToast("المبلغ أكبر من الرصيد الحالي");
                return;
            }

            addSavingsTransaction({
                type: "withdraw",
                amount,
                note: getFormNote(),
                date: getFormDate()
            });

            commit();
            closeModal();
            showToast("تم السحب");

        }
    );
}

/* --- DEBTORS --- */

function openAddDebtorModal() {
    openModal(
        `
        <h2 class="modal-title">إضافة مدين</h2>

        <form id="genericForm">

            <div class="form-group">

                <label for="genericTitle">
                    اسم الشخص
                </label>

                <input
                    type="text"
                    id="genericTitle"
                    placeholder="مثال: أحمد"
                    required
                >

            </div>

            <div class="form-group">

                <label for="genericRequired">
                    المبلغ المطلوب (د.ع)
                </label>

                <input
                    type="number"
                    id="genericRequired"
                    min="0"
                    step="1000"
                    inputmode="numeric"
                    required
                >

            </div>

            <div class="form-group">

                <label for="genericPaid">
                    المدفوع فعلياً (د.ع)
                </label>

                <input
                    type="number"
                    id="genericPaid"
                    min="0"
                    step="1000"
                    inputmode="numeric"
                    value="0"
                >

            </div>

            <div class="form-group">

                <label for="genericNote">
                    ملاحظة (اختياري)
                </label>

                <input
                    type="text"
                    id="genericNote"
                    placeholder="ملاحظة..."
                >

            </div>

            <div class="form-group">

                <label for="genericDate">
                    التاريخ
                </label>

                <input
                    type="date"
                    id="genericDate"
                    required
                >

            </div>

            <button
                type="submit"
                class="form-submit"
            >
                حفظ
            </button>

        </form>
        `
    );

    const form = $("genericForm");

    if (!form) {
        return;
    }

    form.addEventListener(
        "submit",
        (event) => {

            event.preventDefault();

            const name = $("genericTitle")?.value?.trim();

            const required = numberValue($("genericRequired")?.value);

            const paid = numberValue($("genericPaid")?.value);

            if (!name) {
                showToast("أدخل اسم المدين");
                return;
            }

            if (required <= 0) {
                showToast("أدخل مبلغاً صحيحاً");
                return;
            }

            const ledger = getSavingsLedger();

            ledger.debtors.push({
                id: Date.now(),
                name,
                required,
                paid,
                note: getFormNote(),
                date: getFormDate()
            });

            commit();
            closeModal();
            showToast("تمت إضافة المدين");

        }
    );
}

function openDebtorPaymentModal(debtorId) {
    const ledger = getSavingsLedger();

    const debtor = ledger.debtors.find(
        (item) => item.id === Number(debtorId)
    );

    if (!debtor) {
        return;
    }

    const remaining = Math.max(
        numberValue(debtor.required) - numberValue(debtor.paid),
        0
    );

    if (remaining <= 0) {
        showToast("تم تسديد كامل المبلغ");
        return;
    }

    openModal(
        amountFormHtml({
            title: `تسجيل دفعة - ${debtor.name}`,
            label: `المبلغ المتبقي: ${formatNumber(remaining)} د.ع`,
            submitLabel: "تسجيل الدفعة"
        })
    );

    bindGenericForm(
        (amount) => {

            if (amount > remaining) {
                showToast("المبلغ أكبر من المتبقي");
                return;
            }

            debtor.paid = numberValue(debtor.paid) + amount;

            addSavingsTransaction({
                type: "debtorPayment",
                amount,
                note: `دفعة من ${debtor.name}`
            });

            commit();
            closeModal();
            showToast("تم تسجيل الدفعة");

        }
    );
}

function deleteDebtor(debtorId) {
    const ledger = getSavingsLedger();

    ledger.debtors = ledger.debtors.filter(
        (item) => item.id !== Number(debtorId)
    );

    commit();
    showToast("تم حذف المدين");
}

function renderSavingsPage() {
    const stats = savingsStats();

    // Cumulative balance - never resets between months

    setText("savingsBalance", currency(stats.balance));
    setText("savingsDepositsTotal", currency(stats.deposits));
    setText("savingsWithdrawalsTotal", currency(stats.withdrawals));
    setText("savingsFromExpensesTotal", currency(stats.fromExpenses));
    setText("savingsDebtsTotal", currency(stats.debts));
    setText("savingsGrandTotal", currency(stats.grandTotal));

    // Monthly report for the currently viewed month

    const report = savingsMonthlyReport(currentYear, currentMonth);

    setText(
        "savingsMonthTitle",
        `${MONTH_NAMES[currentMonth]} ${currentYear}`
    );

    setText("savingsMonthDeposits", currency(report.deposits));
    setText("savingsMonthFromExpenses", currency(report.fromExpenses));
    setText("savingsMonthWithdrawals", currency(report.withdrawals));
    setText(
        "savingsMonthNet",
        `${report.net >= 0 ? "+" : "-"}${formatNumber(Math.abs(report.net))}`
    );

    renderDebtorsList();

    renderSavingsLog();
}

function renderDebtorsList() {
    const ledger = getSavingsLedger();

    const list = $("debtorsList");

    if (!list) {
        return;
    }

    if (!ledger.debtors.length) {
        list.innerHTML = emptyListHtml("لا يوجد مدينون بعد");
        return;
    }

    list.innerHTML = ledger.debtors
        .slice()
        .reverse()
        .map((debtor) => {

            const required = numberValue(debtor.required);

            const paid = numberValue(debtor.paid);

            const remaining = Math.max(required - paid, 0);

            const settled = remaining === 0;

            return `
                <div class="record-row debtor-row">

                    <div class="record-info">

                        <strong>
                            ${debtor.name}
                            ${settled
                                ? '<span class="settled-badge">تم التسديد</span>'
                                : ""}
                        </strong>

                        <span>
                            ${formatDate(debtor.date)}
                            ${debtor.note ? ` - ${debtor.note}` : ""}
                        </span>

                        <span class="debtor-amounts">
                            المطلوب ${formatNumber(required)}
                            - المدفوع ${formatNumber(paid)}
                            - المتبقي ${formatNumber(remaining)}
                        </span>

                    </div>

                    <div class="debtor-actions">

                        ${settled ? "" : `
                        <button
                            type="button"
                            class="small-action"
                            data-debtor-pay="${debtor.id}"
                        >
                            تسجيل دفعة
                        </button>
                        `}

                        <button
                            type="button"
                            class="delete-record"
                            data-debtor-delete="${debtor.id}"
                            aria-label="حذف"
                        >
                            ×
                        </button>

                    </div>

                </div>
            `;

        })
        .join("");
}

function renderSavingsLog() {
    const ledger = getSavingsLedger();

    const list = $("savingsLogList");

    if (!list) {
        return;
    }

    if (!ledger.transactions.length) {
        list.innerHTML = emptyListHtml("لا توجد حركات بعد");
        return;
    }

    const labels = {
        deposit: "إيداع",
        withdraw: "سحب",
        fromExpenses: "تحويل من المصروفات",
        debtorPayment: "دفعة من مدين"
    };

    const icons = {
        deposit: "＋",
        withdraw: "－",
        fromExpenses: "💰",
        debtorPayment: "👥"
    };

    list.innerHTML = ledger.transactions
        .slice()
        .reverse()
        .map((transaction) => {

            const negative = transaction.type === "withdraw";

            return `
                <div class="record-row">

                    <span class="record-icon">
                        ${icons[transaction.type] || "•"}
                    </span>

                    <div class="record-info">

                        <strong>
                            ${labels[transaction.type] || "حركة"}
                        </strong>

                        <span>
                            ${formatDate(transaction.date)}
                            ${transaction.note ? ` - ${transaction.note}` : ""}
                        </span>

                    </div>

                    <strong class="record-amount ${negative ? "negative" : ""}">
                        ${negative ? "-" : "+"}${formatNumber(transaction.amount)}
                    </strong>

                </div>
            `;

        })
        .join("");
}

/* __APPEND__ */






function recordRowHtml({ listName, record, icon, note }) {
    return `
        <div class="record-row">

            <span class="record-icon">
                ${icon}
            </span>

            <div class="record-info">

                <strong>
                    ${record.title}
                </strong>

                <span>
                    ${note}
                </span>

            </div>

            <strong class="record-amount">
                ${formatNumber(record.amount)}
            </strong>

            <button
                type="button"
                class="delete-record"
                data-delete="${listName}"
                data-delete-id="${record.id}"
                aria-label="حذف"
            >
                ×
            </button>

        </div>
    `;
}

function emptyListHtml(message) {
    return `
        <div class="record-empty">
            ${message}
        </div>
    `;
}

function sumOf(records) {
    return records.reduce(
        (total, record) => total + numberValue(record.amount),
        0
    );
}

function renderExpensesPage() {
    const month = currentMonthData();
    const settings = month.settings;

    setText("loanValue", formatNumber(settings.loan));
    setText("fuelBudgetValue", formatNumber(settings.fuelBudget));
    setText("mobileInternetValue", formatNumber(settings.mobileInternet));
    setText("homeContributionValue", formatNumber(settings.homeContribution));

    setText(
        "savingValue",
        month.savings ? formatNumber(month.savings) : "غير محدد"
    );

    const fixedTotal =
        numberValue(settings.loan) +
        numberValue(settings.fuelBudget) +
        numberValue(settings.mobileInternet) +
        numberValue(settings.homeContribution);

    setText("fixedExpenseTotal", currency(fixedTotal));

    const list = $("customExpenseList");

    if (list) {
        list.innerHTML = month.expenses.length
            ? month.expenses
                .slice()
                .reverse()
                .map((record) => recordRowHtml({
                    listName: "expenses",
                    record,
                    icon: "د.ع",
                    note: "مصروف شخصي"
                }))
                .join("")
            : emptyListHtml("لا توجد مصاريف إضافية بعد");

        wireRecordRows(list, "expenses");
    }
}

function renderCarPage() {
    const month = currentMonthData();
    const settings = month.settings;

    const budget = numberValue(settings.fuelBudget);

    const fuelSpent = sumOf(
        month.carExpenses.filter((item) => item.kind === "fuel")
    );

    const total = sumOf(month.carExpenses);

    setText("carBudgetDisplay", currency(budget));
    setText("carSpentDisplay", currency(fuelSpent));
    setText("carRemainingDisplay", currency(Math.max(budget - fuelSpent, 0)));
    setText("carTotal", currency(total));

    const icons = {
        fuel: "⛽",
        maintenance: "🔧",
        oil: "◉"
    };

    const notes = {
        fuel: "بنزين",
        maintenance: "صيانة",
        oil: "زيت"
    };

    const list = $("carExpensesList");

    if (list) {
        list.innerHTML = month.carExpenses.length
            ? month.carExpenses
                .slice()
                .reverse()
                .map((record) => recordRowHtml({
                    listName: "carExpenses",
                    record,
                    icon: icons[record.kind] || "🚗",
                    note: notes[record.kind] || "مصروف سيارة"
                }))
                .join("")
            : emptyListHtml("لا توجد مصاريف سيارة بعد");

        wireRecordRows(list, "carExpenses");
    }
}

function renderHomeExpensesPage() {
    const month = currentMonthData();
    const settings = month.settings;

    const budget =
        numberValue(settings.homeContribution) +
        numberValue(settings.norhanContribution);

    const basic =
        numberValue(settings.generator) +
        numberValue(settings.homeInternet) +
        numberValue(settings.rent);

    const other = sumOf(month.homeExpenses);

    setText("homeBudgetValue", currency(budget));
    setText("homeContributionSummary", currency(settings.homeContribution));
    setText("norhanContributionSummary", currency(settings.norhanContribution));
    setText("homeBasicTotal", currency(basic));
    setText("homeRemaining", currency(Math.max(budget - basic - other, 0)));

    setText("generatorValue", formatNumber(settings.generator));
    setText("homeInternetValue", formatNumber(settings.homeInternet));
    setText("rentValue", formatNumber(settings.rent));

    const list = $("homeExpensesList");

    if (list) {
        list.innerHTML = month.homeExpenses.length
            ? month.homeExpenses
                .slice()
                .reverse()
                .map((record) => recordRowHtml({
                    listName: "homeExpenses",
                    record,
                    icon: "⌂",
                    note: "مصروف بيت"
                }))
                .join("")
            : emptyListHtml("لا توجد مصاريف بيت إضافية بعد");

        wireRecordRows(list, "homeExpenses");
    }
}

function renderHomePage() {
    const month = currentMonthData();

    const total =
        sumOf(month.expenses) +
        sumOf(month.carExpenses) +
        sumOf(month.homeExpenses);

    setText("homeTotalExpenses", currency(total));

    setText(
        "homeSavings",
        month.savings ? currency(month.savings) : "غير محدد"
    );
}

function renderAll() {
    ensureCurrentMonth();

    renderHomePage();

    renderExpensesPage();

    renderCarPage();

    renderHomeExpensesPage();

    renderTasks();

    renderSavingsPage();
}

/* =========================================================
   INIT
========================================================= */

function init() {
    ensureCurrentMonth();

    // Migrate old per-month savings into the cumulative ledger
    // (idempotent - safe to run on every load)

    migrateSavingsLedger();

    saveDatabase();

    loadTheme();

    updateMonthHeader();

    setupNavigation();

    setupMonthNavigation();

    setupModal();

    setupPageTabs();

    setupActions();

    renderAll();
}

init();








