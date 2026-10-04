/* =========================================================
   DAFTARI - Wallet (محفظتي) tests
   (run with: node tests/wallet.test.js)

   Tests the wallet feature in المصروف الشخصي → المصروفات الأساسية:
     1) UI elements exist in index.html
     2) Wallet balance starts at 0, deposits/withdraws update it
     3) Withdrawal protection: رصيد المحفظة غير كافٍ
     4) Transactions are recorded with date + monthKey
     5) Persistence: survives localStorage save/reload
     6) Finance: deposit reduces remaining, withdrawal increases it
     7) End-to-end: 500,000 → deposit 100,000 → withdraw 30,000
 ========================================================= */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SCRIPT_SOURCE = fs.readFileSync(
    path.join(__dirname, "..", "script.js"),
    "utf8"
);

const HTML_SOURCE = fs.readFileSync(
    path.join(__dirname, "..", "index.html"),
    "utf8"
);

const STORAGE_KEY = "daftari_v2";

let passed = 0;
let failed = 0;

function check(condition, label) {
    if (condition) {
        passed += 1;
        console.log(`  ok   ${label}`);
    } else {
        failed += 1;
        console.log(`  FAIL ${label}`);
    }
}

function createElement(tag = "div", registry = null) {
    const classes = new Set();
    const listeners = {};
    const attributes = {};

    let html = "";

    const element = {
        tagName: String(tag).toUpperCase(),
        id: "",
        textContent: "",
        value: "",
        disabled: false,
        checked: false,
        children: [],
        dataset: {},
        style: {},

        classList: {
            add: (...names) => {
                names.forEach((name) => classes.add(name));
            },
            remove: (...names) => {
                names.forEach((name) => classes.delete(name));
            },
            contains: (name) => classes.has(name),
            toggle: (name, force) => {
                const add = force === undefined
                    ? !classes.has(name)
                    : Boolean(force);
                if (add) {
                    classes.add(name);
                } else {
                    classes.delete(name);
                }
                return add;
            }
        },

        addEventListener(type, handler) {
            if (!listeners[type]) {
                listeners[type] = [];
            }
            listeners[type].push(handler);
        },

        removeEventListener() {},

        hasListener(type) {
            return Boolean(listeners[type] && listeners[type].length);
        },

        dispatch(type, event) {
            (listeners[type] || []).forEach((handler) => handler(
                event || { type, target: element, preventDefault() {} }
            ));
        },

        setAttribute(name, value) {
            attributes[name] = String(value);
        },

        getAttribute(name) {
            return Object.prototype.hasOwnProperty.call(attributes, name)
                ? attributes[name]
                : null;
        },

        querySelector() {
            return null;
        },

        querySelectorAll() {
            return [];
        },

        closest() {
            return null;
        },

        appendChild(child) {
            element.children.push(child);
            return child;
        },

        remove() {},
        focus() {},
        contains() {
            return false;
        }
    };

    Object.defineProperty(element, "innerHTML", {
        get() {
            return html;
        },
        set(value) {
            const next = String(value);
            if (registry) {
                (html.match(/id="[^"]+"/g) || []).forEach((token) => {
                    registry.delete(token.slice(4, -1));
                });
            }
            html = next;
        }
    });

    return element;
}

function createDocument() {
    const elements = new Map();

    const document = {
        body: createElement("body", elements),
        documentElement: createElement("html", elements),

        getElementById(id) {
            if (!elements.has(id)) {
                const element = createElement("div", elements);
                element.id = id;
                elements.set(id, element);
            }
            return elements.get(id);
        },

        querySelector: () => null,
        querySelectorAll: () => [],
        createElement,
        addEventListener() {},
        removeEventListener() {}
    };

    document.elements = elements;
    return document;
}

function createApp(storageSeed = {}) {
    const store = new Map(
        Object.entries(storageSeed).map(([key, value]) => [key, String(value)])
    );

    const document = createDocument();

    const sandbox = {
        console,
        setTimeout,
        clearTimeout,
        JSON,
        Math,
        Date,
        document,
        window: {
            scrollTo() {},
            addEventListener() {},
            location: { origin: "https://daftari.test" }
        },
        navigator: { onLine: true },
        localStorage: {
            getItem: (key) => (store.has(key) ? store.get(key) : null),
            setItem: (key, value) => {
                store.set(key, String(value));
            },
            removeItem: (key) => {
                store.delete(key);
            }
        }
    };

    sandbox.window.document = document;

    vm.createContext(sandbox);
    vm.runInContext(SCRIPT_SOURCE, sandbox, { filename: "script.js" });

    const app = {
        sandbox,
        document,
        store,
        getElement: (id) => document.getElementById(id)
    };

    return app;
}

function seedDatabase(database) {
    const store = {};
    store[STORAGE_KEY] = JSON.stringify(database);
    return store;
}

function nowKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function testWalletMarkup() {
    console.log("\n1) UI elements in index.html");

    [
        "walletCard",
        "walletToggleButton",
        "walletCardBody",
        "walletDepositButton",
        "walletWithdrawButton"
    ].forEach((id) => check(
        HTML_SOURCE.indexOf(`id="${id}"`) !== -1,
        `index.html: العنصر #${id} موجود`
    ));

    check(
        HTML_SOURCE.indexOf("محفظتي") !== -1,
        "index.html: العنوان 'محفظتي' موجود"
    );

    check(
        HTML_SOURCE.indexOf("إيداع") !== -1 &&
        HTML_SOURCE.indexOf("صرف") !== -1,
        "index.html: خيارا إيداع وصرف موجودان"
    );

    /* السجل موجود داخل بطاقة المحفظة نفسها، لا في الواجهة الرئيسية */
    check(
        HTML_SOURCE.indexOf('id="walletLogList"') !== -1,
        "index.html: سجل حركات المحفظة داخل البطاقة"
    );

    check(
        HTML_SOURCE.indexOf('id="walletBalanceValue"') === -1,
        "index.html: لا يُعرض الرصيد بشكل كبير في الواجهة الرئيسية"
    );
}

async function testWalletCardToggle() {
    console.log("\n2) فتح/إغلاق بطاقة محفظتي (إيداع / صرف فقط)");

    const app = createApp(seedDatabase({
        savingsLedger: { walletTransactions: [], transactions: [], debtors: [] },
        months: {}
    }));

    const card = app.getElement("walletCard");
    const button = app.getElement("walletToggleButton");
    const toggle = app.sandbox.toggleWalletCard;

    check(!card.classList.contains("open"), "البطاقة مغلقة افتراضياً");

    toggle();

    check(card.classList.contains("open"), "بعد الضغط: البطاقة مفتوحة");
    check(
        button.getAttribute("aria-expanded") === "true",
        "aria-expanded = true عند الفتح"
    );

    toggle();

    check(!card.classList.contains("open"), "بعد الضغط مرة أخرى: البطاقة مغلقة");
    check(
        button.getAttribute("aria-expanded") === "false",
        "aria-expanded = false عند الإغلاق"
    );
}

async function testWalletModalFlow() {
    console.log("\n3) التدفق عبر نافذة المحفظة (فواصل + إيداع + صرف)");

    const app = createApp(seedDatabase({
        savingsLedger: { walletTransactions: [], transactions: [], debtors: [] },
        months: {}
    }));

    const openWalletModal = app.sandbox.openWalletModal;
    const walletBalance = app.sandbox.walletBalance;
    const toast = app.getElement("toast");

    function submitAmount(value) {
        app.getElement("genericAmount").value = value;
        app.getElement("genericForm").dispatch("submit", { preventDefault() {} });
    }

    /* --- إيداع --- */

    openWalletModal("deposit");

    const modalHtml = app.getElement("modalContent").innerHTML;

    check(/data-money/.test(modalHtml), "حقل المبلغ يدعم فاصل الآلاف (data-money)");
    check(/الرصيد الحالي/.test(modalHtml), "النافذة تعرض الرصيد الحالي");

    submitAmount("1,250,000");

    check(
        walletBalance() === 1250000,
        "إيداع 1,250,000 عبر النافذة (الفاصل لا يؤثر على الرقم)"
    );

    /* --- صرف --- */

    openWalletModal("withdraw");

    check(
        /صرف/.test(app.getElement("modalContent").innerHTML),
        "نافذة الصرف وزر التأكيد مكتوبان 'صرف'"
    );

    submitAmount("250,000");

    check(
        walletBalance() === 1000000,
        "صرف 250,000 → الرصيد 1,000,000"
    );

    /* --- صرف أكبر من الرصيد --- */

    openWalletModal("withdraw");
    submitAmount("5,000,000");

    check(
        walletBalance() === 1000000,
        "الصرف بأكثر من الرصيد مرفوض والرصيد لم يتغير"
    );

    check(
        toast.textContent === "رصيد المحفظة غير كافٍ.",
        "رسالة الرفض: 'رصيد المحفظة غير كافٍ.'"
    );
}

async function testWalletLogic() {
    console.log("\n2) منطق المحفظة (الإيداع / السحب / الحماية)");

    const db = {
        savingsLedger: {
            walletTransactions: [],
            transactions: [],
            debtors: []
        },
        months: {}
    };

    const app = createApp(seedDatabase(db));

    const walletBalance = app.sandbox.walletBalance;
    const addWalletTransaction = app.sandbox.addWalletTransaction;
    const getWalletTransactions = app.sandbox.getWalletTransactions;
    const walletNetForMonth = app.sandbox.walletNetForMonth;
    const monthFinance = app.sandbox.monthFinance;
    const availableBalance = app.sandbox.availableBalance;

    check(walletBalance() === 0, "الرصيد الابتدائي = 0");

    const r1 = addWalletTransaction("deposit", 100000);
    check(r1.ok === true, "إيداع 100,000 ينجاح");
    check(r1.transaction.type === "deposit", "سجل الإيداع نوعه deposit");
    check(r1.transaction.amount === 100000, "مبلغ الإيداع = 100000");

    check(walletBalance() === 100000, "الرصيد بعد الإيداع = 100,000");

    const r2 = addWalletTransaction("withdraw", 30000);
    check(r2.ok === true, "سحب 30,000 ينجاح");
    check(walletBalance() === 70000, "الرصيد بعد السحب = 70,000");

    const r3 = addWalletTransaction("withdraw", 100000);
    check(r3.ok === false, "سحب 100,000 من 70,000 مرفوض");
    check(
        r3.message === "رصيد المحفظة غير كافٍ.",
        "رسالة الرفض: 'رصيد المحفظة غير كافٍ.'"
    );

    check(getWalletTransactions().length === 2, "تم حفظ معاملتين في السجل");
    check(walletBalance() === 70000, "الرصيد غير متأثر بالمعاملة المرفوضة");

    const txs = getWalletTransactions();
    check(
        txs.every((t) => t.monthKey !== undefined),
        "كل معاملة تحمل monthKey"
    );
    check(
        txs.every((t) => t.date !== undefined),
        "كل معاملة تحمل تاريخ"
    );
}

async function testFinanceLogic() {
    console.log("\n3)حساب التمويل (منصرف / متبقي / محفظتي)");

    const db = {
        savingsLedger: {
            walletTransactions: [],
            transactions: [],
            debtors: []
        },
        months: {}
    };

    const app = createApp(seedDatabase(db));

    const addWalletTransaction = app.sandbox.addWalletTransaction;
    const availableBalance = app.sandbox.availableBalance;
    const monthFinance = app.sandbox.monthFinance;
    const currentMonthData = app.sandbox.currentMonthData;
    const ensureCurrentMonth = app.sandbox.ensureCurrentMonth;
    const monthKey = app.sandbox.monthKey;

    ensureCurrentMonth();

    const month = currentMonthData();
    month.settings.salary = 500000;
    month.settings.loan = 0;
    month.settings.fuelBudget = 0;
    month.settings.mobileInternet = 0;
    month.settings.homeContribution = 0;
    month.expenses = [];

    const finance0 = monthFinance(month, 0);
    check(finance0.remaining === 500000, "المتبقي الأولي = 500,000 (بدون محفظة)");

    addWalletTransaction("deposit", 100000);

    const finance1 = monthFinance(month, 0);
    check(finance1.walletNet === 100000, "صافي المحفظة = +100,000 بعد الإيداع");
    check(finance1.remaining === 400000, "المتبقي = 400,000 بعد إيداع 100,000");

    addWalletTransaction("withdraw", 30000);

    const finance2 = monthFinance(month, 0);
    check(finance2.walletNet === 70000, "صافي المحفظة = 70,000 بعد صرف 30,000");
    check(
        finance2.spent === 30000,
        "الصرف 30,000 يُحسب ضمن المصروفات"
    );
    check(
        finance2.remaining === 370000,
        "المتبقي = 370,000 بعد صرف 30,000 (لا خصم مزدوج)"
    );
    check(availableBalance(month) === 370000, "الرصيد المتاح = 370,000");
}

async function testPersistence() {
    console.log("\n4) الاستمرارية (localStorage حفظ وإعادة تحميل)");

    const db = {
        savingsLedger: {
            walletTransactions: [],
            transactions: [],
            debtors: []
        },
        months: {}
    };

    const store = new Map([[STORAGE_KEY, JSON.stringify(db)]]);

    const document = createDocument();

    const sandbox = {
        console,
        setTimeout,
        clearTimeout,
        JSON,
        Math,
        Date,
        document,
        window: {
            scrollTo() {},
            addEventListener() {},
            location: { origin: "https://daftari.test" }
        },
        navigator: { onLine: true },
        localStorage: {
            getItem: (key) => (store.has(key) ? store.get(key) : null),
            setItem: (key, value) => {
                store.set(key, String(value));
            },
            removeItem: (key) => {
                store.delete(key);
            }
        }
    };

    sandbox.window.document = document;

    vm.createContext(sandbox);
    vm.runInContext(SCRIPT_SOURCE, sandbox, { filename: "script.js" });

    sandbox.database = JSON.parse(store.get(STORAGE_KEY) || "{}");
    sandbox.addWalletTransaction("deposit", 100000);
    sandbox.commit();

    check(
        sandbox.walletBalance() === 100000,
        "الرصيد بعد الإيداع قبل الحفظ = 100,000"
    );

    const reloadedDb = JSON.parse(store.get(STORAGE_KEY));
    check(
        Array.isArray(reloadedDb.savingsLedger.walletTransactions) &&
        reloadedDb.savingsLedger.walletTransactions.length === 1,
        "المعاملة محفوظة في localStorage"
    );

    check(
        reloadedDb.savingsLedger.walletTransactions[0].type === "deposit" &&
        reloadedDb.savingsLedger.walletTransactions[0].amount === 100000,
        "المعاملة المحفوظة: نوع deposit، مبلغ 100000"
    );
}

async function testEndToEnd() {
    console.log("\n5) نهائي-إلى-نهاية: 500,000 → إيداع 100,000 → سحب 30,000");

    const db = {
        savingsLedger: {
            walletTransactions: [],
            transactions: [],
            debtors: []
        },
        months: {}
    };

    const app = createApp(seedDatabase(db));

    const addWalletTransaction = app.sandbox.addWalletTransaction;
    const walletBalance = app.sandbox.walletBalance;
    const monthFinance = app.sandbox.monthFinance;
    const currentMonthData = app.sandbox.currentMonthData;
    const ensureCurrentMonth = app.sandbox.ensureCurrentMonth;

    ensureCurrentMonth();

    const month = currentMonthData();
    month.settings.salary = 500000;
    month.settings.loan = 0;
    month.settings.fuelBudget = 0;
    month.settings.mobileInternet = 0;
    month.settings.homeContribution = 0;
    month.expenses = [];

    check(walletBalance() === 0, "البداية: رصيد المحفظة = 0");

    const r1 = addWalletTransaction("deposit", 100000);
    check(r1.ok, "إيداع 100,000 ناجح");
    check(walletBalance() === 100000, "الرصيد بعد الإيداع = 100,000");

    const r2 = addWalletTransaction("withdraw", 30000);
    check(r2.ok, "سحب 30,000 ناجح");
    check(walletBalance() === 70000, "الرصيد بعد السحب = 70,000");

    const finance = monthFinance(month, 0);
    check(finance.walletNet === 70000, "صافي المحفظة = 70,000");
    check(finance.spent === 30000, "المصروفات = 30,000 بعد الصرف");
    check(
        finance.remaining === 370000,
        "المتبقي = 370,000 (500k - 100k إيداع - 30k صرف)"
    );

    const r3 = addWalletTransaction("withdraw", 100000);
    check(!r3.ok, "سحب 100,000 من 70,000 مرفوض");
    check(r3.message === "رصيد المحفظة غير كافٍ.", "رسالة الرفض صحيحة");
}

async function main() {
    await testWalletMarkup();
    await testWalletCardToggle();
    await testWalletModalFlow();
    await testWalletLogic();
    await testFinanceLogic();
    await testPersistence();
    await testEndToEnd();

    console.log(`\n${passed} passed, ${failed} failed`);

    if (failed > 0) {
        process.exit(1);
    }
}

main();
