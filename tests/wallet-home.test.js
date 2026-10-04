/* =========================================================
   DAFTARI - wallet / groceries / money-input / fuel-log tests
   (run with: node tests/wallet-home.test.js)

     1) فواصل الآلاف أثناء الكتابة (formatter موحد) والتحويل لرقم
     2) محفظتي: إيداع / سحب / منع السحب الزائد / ربط بالمتاح
     3) المواد المنزلية: فواكه / خضروات / لحوم / مواد منزلية
        وإدخالها في إجمالي مصروف البيت
     4) سجل البنزين داخل قسم البنزين + بقاء العمليات القديمة
     5) المحفظة والمزامنة بين جهازين وبعد تسجيل الخروج/الدخول
========================================================= */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createServer, createClient } = require("./fake-firebase.js");

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

/* =========================================================
   FAKE DOM (يكفي لتشغيل script.js)
========================================================= */

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

    /*
        مثل DOM الحقيقي: إعادة إسناد innerHTML تُلغي العناصر
        القديمة (وبالتالي مستمعي أحداثها). هذا مطلوب لأن
        openModal() تستبدل محتوى النافذة في كل مرة.
    */
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

/* =========================================================
   APP (script.js داخل سياق vm مع DOM وهمي + localStorage)
========================================================= */

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

    vm.runInContext(
        `
        globalThis.__daftari = {
            getDatabase: () => database,
            currentMonthData,
            ensureCurrentMonth,
            monthKey,
            numberValue,
            parseDecimal,
            formatNumber,
            currency,
            formatMoneyDigits,
            formatMoneyInput,
            moneyInputValue,
            amountFormHtml,
            expenseFormHtml,
            fuelFormHtml,
            carPartFormHtml,
            savingsTransactionFormHtml,
            openWalletModal,
            openGroceryModal,
            openGroceryCategory,
            openFuelModal,
            addWalletTransaction,
            walletBalance,
            walletNetForMonth,
            availableBalance,
            buildGroceryRecord,
            getGroceryRecords,
            getFuelRecords,
            getSalary,
            renderAll,
            renderExpensesPage,
            renderWalletPage,
            renderGroceriesPage,
            renderGroceryCategoryPage,
            renderHomePage,
            renderHomeExpensesPage,
            renderCarPage,
            GROCERY_CATEGORIES,
            setMonth: (year, month) => {
                currentYear = year;
                currentMonth = month;
                ensureCurrentMonth();
            },
            getView: () => ({ currentYear, currentMonth })
        };
        `,
        sandbox,
        { filename: "expose.js" }
    );

    return Object.assign(
        {
            sandbox,
            document,
            store,
            getElement: (id) => document.getElementById(id)
        },
        sandbox.__daftari
    );
}

/* تواريخ الاختبار داخل الشهر الحالي حتى تُحفظ في سجلات الشهر */
function currentMonthKey() {
    const now = new Date();

    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthDay(day) {
    return `${currentMonthKey()}-${String(day).padStart(2, "0")}`;
}



/* ---------- helpers ---------- */

function submit(app, formId) {
    app.getElement(formId).dispatch("submit", { preventDefault() {} });
}

/* a text <input> double with a caret, like the browser */
function fakeInput(value, caret) {
    const input = {
        value,
        selectionStart: caret === undefined ? value.length : caret,
        setSelectionRange(start) {
            input.selectionStart = start;
        }
    };

    return input;
}

/* "type" characters one by one at the end, the way the browser does */
function typeInto(app, text) {
    const input = fakeInput("");

    for (const char of text) {
        input.value = input.value.slice(0, input.selectionStart) + char +
            input.value.slice(input.selectionStart);
        input.selectionStart += 1;
        app.formatMoneyInput(input);
    }

    return input;
}

/* salary so that the month's available balance is exactly `target` */
function setAvailable(app, target) {
    const month = app.currentMonthData();

    month.expenses = [];

    const settings = month.settings;

    const fixed =
        settings.loan + settings.fuelBudget +
        settings.mobileInternet + settings.homeContribution;

    month.settings.salary = fixed + target;
}

function remainingText(app) {
    app.renderExpensesPage();

    return app.getElement("monthRemaining").textContent;
}

/* =========================================================
   1) money inputs
========================================================= */

function testMoneyInputs() {
    console.log("\n1) فواصل الآلاف أثناء الكتابة");

    const app = createApp();

    ["1", "10", "100", "1,000", "10,000", "100,000", "1,000,000", "10,000,000"]
        .forEach((expected) => {
            const digits = expected.replace(/,/g, "");
            const typed = typeInto(app, digits);

            check(
                typed.value === expected,
                `كتابة ${digits} تظهر ${expected}`
            );
        });

    check(
        typeInto(app, "1250000").value === "1,250,000",
        "1250000 -> 1,250,000"
    );

    /* deleting a digit re-formats immediately */
    const deleting = fakeInput("1,250,000", 9);
    deleting.value = "1,250,00";
    deleting.selectionStart = 8;
    app.formatMoneyInput(deleting);

    check(deleting.value === "125,000", "حذف رقم يعيد التنسيق مباشرة (125,000)");

    /* editing in the middle keeps the caret near the edit */
    const middle = fakeInput("1,9250,000", 3);
    app.formatMoneyInput(middle);

    check(middle.value === "19,250,000", "إدراج رقم في المنتصف يعيد التنسيق");
    check(
        middle.selectionStart === 2,
        "المؤشر يبقى بعد الرقم المُدرج وليس في نهاية الحقل"
    );

    const arabic = fakeInput("١٢٣٤٥٦٧");
    app.formatMoneyInput(arabic);
    check(arabic.value === "1,234,567", "الأرقام العربية تتحول وتُنسّق");

    const junk = fakeInput("12a3");
    app.formatMoneyInput(junk);
    check(junk.value === "123", "الأحرف غير الرقمية تُحذف");

    /* parsing: separators never reach the calculations */
    check(app.numberValue("1,250,000") === 1250000, "numberValue('1,250,000') = 1250000");
    check(app.numberValue("1000000") === 1000000, "numberValue('1000000') = 1000000");
    check(typeof app.numberValue("1,000,000") === "number", "النتيجة رقم وليست نصاً");
    check(app.parseDecimal("1,250.5") === 1250.5, "parseDecimal يتجاوز الفواصل");
    check(app.numberValue("-5") === 0, "القيمة السالبة تصبح 0");
    check(app.moneyInputValue(1250000) === "1,250,000", "عرض المبلغ المحفوظ بالفواصل");
    check(app.moneyInputValue(0) === "", "الصفر يظهر فارغاً");

    /* opening a field that has a saved amount shows separators */
    check(
        /value="1,250,000"/.test(app.amountFormHtml({ title: "t", label: "l", value: 1250000 })),
        "فتح حقل فيه مبلغ محفوظ يعرضه بالفواصل"
    );

    /* every money field is marked, quantity/liters are not */
    const moneyForms = {
        "نموذج المبلغ": [app.amountFormHtml({ title: "t", label: "l" }), "genericAmount"],
        "نموذج المصروف": [app.expenseFormHtml({ title: "t", label: "l" }), "genericAmount"],
        "نموذج الادخار": [app.savingsTransactionFormHtml({ title: "t", submitLabel: "s" }), "genericAmount"],
        "سعر لتر البنزين": [app.fuelFormHtml(), "fuelPricePerLiter"],
        "إجمالي البنزين": [app.fuelFormHtml(), "fuelTotal"],
        "سعر الزيوت/الفلاتر/البطارية": [app.carPartFormHtml("oil"), "carPartAmount"]
    };

    Object.keys(moneyForms).forEach((label) => {
        const [html, id] = moneyForms[label];
        const tag = html.slice(html.lastIndexOf("<input", html.indexOf(`id="${id}"`)));
        const block = tag.slice(0, tag.indexOf(">") + 1);

        check(
            /data-money/.test(block) && /type="text"/.test(block),
            `حقل المبلغ يدعم الفواصل: ${label}`
        );
    });

    ["fuelLiters"].forEach((id) => {
        const html = app.fuelFormHtml();
        const block = html.slice(
            html.lastIndexOf("<input", html.indexOf(`id="${id}"`)),
            html.indexOf(">", html.indexOf(`id="${id}"`))
        );

        check(!/data-money/.test(block), `حقل ${id} (لترات) بدون تنسيق مبالغ`);
    });

    const partHtml = app.carPartFormHtml("oil");
    const qtyBlock = partHtml.slice(
        partHtml.lastIndexOf("<input", partHtml.indexOf('id="carPartQuantity"')),
        partHtml.indexOf(">", partHtml.indexOf('id="carPartQuantity"'))
    );

    check(!/data-money/.test(qtyBlock), "حقل الكمية بدون تنسيق مبالغ");

    /* the value that reaches storage is a real number */
    const saving = createApp();

    saving.openGroceryCategory("fruits");
    saving.openGroceryModal();
    saving.getElement("groceryName").value = "تفاح";
    saving.getElement("groceryQuantity").value = "2";
    saving.getElement("groceryUnitPrice").value = "1,250,000";
    saving.getElement("groceryUnitPrice").dispatch("input");
    submit(saving, "groceryForm");

    const record = saving.currentMonthData().homeExpenses.slice(-1)[0];

    check(
        record && record.unitPrice === 1250000 && record.amount === 2500000,
        "المحفوظ أرقام حقيقية بدون فواصل (1250000)"
    );
    check(
        !/"\d{1,3}(,\d{3})+"/.test(saving.store.get(STORAGE_KEY)),
        "localStorage لا يحتوي على نص بفواصل"
    );
}

/* =========================================================
   2) wallet
========================================================= */

function testWallet() {
    console.log("\n2) محفظتي");

    const app = createApp();

    setAvailable(app, 500000);

    check(remainingText(app) === app.currency(500000), "المتاح قبل المحفظة 500,000");
    check(app.walletBalance() === 0, "رصيد المحفظة يبدأ من 0");

    /* deposit 100,000 through the real modal */
    app.openWalletModal("deposit");
    app.getElement("genericAmount").value = "100,000";
    submit(app, "genericForm");

    check(app.walletBalance() === 100000, "إيداع 100,000: المحفظة 100,000");
    check(remainingText(app) === app.currency(400000), "إيداع 100,000: المتاح 400,000");

    /* withdraw 30,000 */
    app.openWalletModal("withdraw");
    app.getElement("genericAmount").value = "30,000";
    submit(app, "genericForm");

    check(app.walletBalance() === 70000, "سحب 30,000: المحفظة 70,000");
    check(remainingText(app) === app.currency(430000), "سحب 30,000: المتاح 430,000");

    /* over-withdraw is rejected */
    app.openWalletModal("withdraw");
    app.getElement("genericAmount").value = "100,000";
    submit(app, "genericForm");

    check(app.walletBalance() === 70000, "سحب 100,000 مرفوض: الرصيد 70,000 كما هو");
    check(remainingText(app) === app.currency(430000), "السحب المرفوض لا يغيّر المتاح");
    check(
        app.getElement("toast").textContent === "رصيد المحفظة غير كافٍ.",
        "رسالة: رصيد المحفظة غير كافٍ."
    );

    const bad = app.addWalletTransaction("deposit", 0);
    check(!bad.ok, "مبلغ فارغ/صفر مرفوض");
    check(!app.addWalletTransaction("deposit", -5).ok, "مبلغ سالب مرفوض");
    check(
        app.getDatabase().savingsLedger.walletTransactions.length === 2,
        "العمليات المرفوضة لا تُسجَّل"
    );

    /* log */
    app.renderWalletPage();

    const log = app.getElement("walletLogList").innerHTML;

    check(log.indexOf("إيداع") !== -1 && log.indexOf("+100,000 د.ع") !== -1, "السجل: إيداع +100,000");
    check(log.indexOf("سحب") !== -1 && log.indexOf("-30,000 د.ع") !== -1, "السجل: سحب -30,000");
    check(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/.test(log), "السجل: التاريخ والوقت");
    check(log.indexOf(app.currency(70000)) !== -1, "السجل: الرصيد بعد العملية");
    check(
        app.getElement("walletBalanceValue").textContent === app.currency(70000),
        "الصفحة تعرض رصيد المحفظة بالفواصل"
    );

    /* month change never resets the wallet */
    const view = app.getView();
    const next = (view.currentMonth + 1) % 12;

    app.setMonth(next === 0 ? view.currentYear + 1 : view.currentYear, next);

    check(app.walletBalance() === 70000, "تغيير الشهر لا يصفّر المحفظة");

    app.setMonth(view.currentYear, view.currentMonth);

    check(app.walletBalance() === 70000, "العودة للشهر الأصلي: الرصيد كما هو");

    /* survives reload */
    const reloaded = createApp({ [STORAGE_KEY]: app.store.get(STORAGE_KEY) });

    check(reloaded.walletBalance() === 70000, "إعادة تحميل التطبيق: الرصيد باقٍ");

    /* old data without any wallet keeps working */
    const legacy = createApp({
        [STORAGE_KEY]: JSON.stringify({
            months: {},
            savingsLedger: { transactions: [{ id: 1, type: "deposit", amount: 5000 }], debtors: [] }
        })
    });

    check(legacy.walletBalance() === 0, "بيانات قديمة بدون محفظة: لا أخطاء، الرصيد 0");
    check(
        legacy.getDatabase().savingsLedger.transactions.length === 1,
        "بيانات الادخار القديمة ما زالت موجودة"
    );
}

/* =========================================================
   3) groceries
========================================================= */

function addGrocery(app, group, values) {
    app.openGroceryCategory(group);
    app.openGroceryModal();

    app.getElement("groceryName").value = values.name;

    if (values.subtype) {
        app.getElement("grocerySubtype").value = values.subtype;
    }

    app.getElement("groceryQuantity").value = String(values.quantity);

    if (values.unit) {
        app.getElement("groceryUnit").value = values.unit;
    }

    app.getElement("groceryUnitPrice").value = String(values.price);
    app.getElement("groceryUnitPrice").dispatch("input");

    submit(app, "groceryForm");
}

function testGroceries() {
    console.log("\n3) المواد المنزلية");

    const app = createApp();

    const before = app.currentMonthData().homeExpenses.length;

    check(
        Object.keys(app.GROCERY_CATEGORIES).join() === "fruits,vegetables,meat,household",
        "الأقسام: فواكه / خضروات / لحوم / مواد منزلية"
    );
    check(
        app.GROCERY_CATEGORIES.meat.subtypes.join() === "لحم,دجاج,سمك",
        "اللحوم: لحم / دجاج / سمك"
    );

    /* total shown in the form is quantity x unit price */
    app.openGroceryCategory("fruits");
    app.openGroceryModal();
    app.getElement("groceryQuantity").value = "2";
    app.getElement("groceryUnitPrice").value = "8,500";
    app.getElement("groceryUnitPrice").dispatch("input");

    check(
        app.getElement("groceryTotal").value === "17,000",
        "الإجمالي تلقائي: 2 × 8,500 = 17,000"
    );

    /* validation */
    const base = { group: "fruits", name: "تفاح", quantity: 2, unit: "كغم", unitPrice: 3000 };

    check(!app.buildGroceryRecord(Object.assign({}, base, { name: "  " })).ok, "اسم فارغ مرفوض");
    check(!app.buildGroceryRecord(Object.assign({}, base, { quantity: "" })).ok, "كمية فارغة مرفوضة");
    check(!app.buildGroceryRecord(Object.assign({}, base, { quantity: -2 })).ok, "كمية سالبة مرفوضة");
    check(!app.buildGroceryRecord(Object.assign({}, base, { unitPrice: "" })).ok, "سعر فارغ مرفوض");
    check(!app.buildGroceryRecord(Object.assign({}, base, { unitPrice: -3000 })).ok, "سعر وحدة سالب مرفوض");
    check(!app.buildGroceryRecord({ group: "meat", name: "x", quantity: 1, unitPrice: 1000 }).ok, "نوع اللحم مطلوب");

    const apple = app.buildGroceryRecord(base);

    check(apple.ok && apple.record.amount === 6000, "تفاح: 2 كغم × 3,000 = 6,000");
    check(
        app.buildGroceryRecord({ group: "vegetables", name: "طماطم", quantity: 3, unit: "كغم", unitPrice: 1500 }).record.amount === 4500,
        "طماطم: 3 × 1,500 = 4,500"
    );
    check(
        app.buildGroceryRecord({ group: "meat", subtype: "دجاج", name: "دجاج", quantity: 2, unit: "كغم", unitPrice: 8000 }).record.amount === 16000,
        "دجاج: 2 × 8,000 = 16,000"
    );
    check(
        app.buildGroceryRecord({ group: "meat", subtype: "سمك", name: "سمك", quantity: 3, unit: "كغم", unitPrice: 7500 }).record.amount === 22500,
        "سمك: 3 × 7,500 = 22,500"
    );
    check(
        app.buildGroceryRecord({ group: "household", name: "مناديل", quantity: 3, unit: "علبة", unitPrice: 2000 }).record.amount === 6000,
        "مناديل: 3 علب × 2,000 = 6,000"
    );

    /* required scenario: 10,000 + 15,000 + 40,000 + 20,000 = 85,000 */
    const homeBefore = app.currentMonthData().homeExpenses.reduce((s, r) => s + r.amount, 0);

    app.renderHomePage();
    const totalBefore = app.getElement("homeTotalExpenses").textContent;

    addGrocery(app, "fruits", { name: "تفاح", quantity: 1, price: "10,000" });
    addGrocery(app, "vegetables", { name: "طماطم", quantity: 1, price: "15,000" });
    addGrocery(app, "meat", { name: "لحم غنم", subtype: "لحم", quantity: 1, price: "40,000" });
    addGrocery(app, "household", { name: "منظف", quantity: 1, price: "20,000" });

    const month = app.currentMonthData();
    const groceries = month.homeExpenses.filter((r) => r.group);

    check(groceries.length === 4, "أُضيفت 4 عمليات من الأقسام الأربعة");
    check(
        groceries.reduce((s, r) => s + r.amount, 0) === 85000,
        "إجمالي المواد المنزلية = 85,000"
    );

    app.renderAll();

    check(
        app.getElement("homeGroceriesTotal").textContent === app.currency(85000),
        "بطاقة المواد المنزلية تعرض 85,000 د.ع"
    );
    check(
        app.getElement("groceriesTotal").textContent === app.currency(85000),
        "صفحة المواد المنزلية تعرض 85,000 د.ع"
    );
    check(
        app.getElement("homeTotalExpenses").textContent ===
            app.currency(
                month.expenses.reduce((s, r) => s + r.amount, 0) +
                month.carExpenses.reduce((s, r) => s + r.amount, 0) +
                homeBefore + 85000
            ),
        "الـ85,000 داخلة في إجمالي المصروفات (مصروف البيت)"
    );

    /* home remaining uses the same list -> includes groceries */
    const settings = month.settings;
    const budget = settings.homeContribution + settings.norhanContribution;
    const basic = settings.generator + settings.homeInternet + settings.rent;
    const expectedRemaining = Math.max(budget - basic - (homeBefore + 85000), 0);

    check(
        app.getElement("homeRemaining").textContent === app.currency(expectedRemaining),
        "المتبقي في ميزانية البيت يحسب المواد المنزلية"
    );

    /* groceries are not repeated in the generic home list */
    check(
        app.getElement("homeExpensesList").innerHTML.indexOf("تفاح") === -1,
        "مصاريف البيت العامة لا تكرر المواد المنزلية"
    );

    /* per-category log + total */
    app.openGroceryCategory("fruits");
    app.renderGroceryCategoryPage();

    const fruitsHtml = app.getElement("groceryList").innerHTML;

    check(fruitsHtml.indexOf("تفاح") !== -1, "سجل الفواكه يعرض التفاح");
    check(fruitsHtml.indexOf("طماطم") === -1, "سجل الفواكه لا يعرض الخضروات");
    check(
        app.getElement("groceryCategoryTotal").textContent === app.currency(10000),
        "إجمالي الفواكه 10,000 د.ع"
    );

    app.openGroceryCategory("meat");
    check(
        app.getElement("groceryTypeTabs").innerHTML.indexOf("دجاج") !== -1 &&
        app.getElement("groceryTypeTabs").innerHTML.indexOf("سمك") !== -1,
        "اللحوم: تبويبات لحم / دجاج / سمك"
    );

    /* stored in the existing synced list; nothing deleted */
    check(
        month.homeExpenses.length === before + 4,
        "المواد تُخزَّن داخل homeExpenses الحالية بدون حذف شيء"
    );

    /* old home expenses (no group) still counted and shown */
    const legacy = createApp({
        [STORAGE_KEY]: JSON.stringify({
            months: {
                [new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0")]: {
                    year: new Date().getFullYear(),
                    month: new Date().getMonth(),
                    settings: {},
                    expenses: [],
                    carExpenses: [],
                    homeExpenses: [{ id: 1, title: "صيانة سباكة", amount: 30000, date: new Date().toISOString() }]
                }
            }
        })
    });

    legacy.renderAll();

    check(
        legacy.getElement("homeExpensesList").innerHTML.indexOf("صيانة سباكة") !== -1,
        "مصاريف البيت القديمة ما زالت ظاهرة"
    );
}

/* =========================================================
   4) fuel log
========================================================= */

function testFuelLog() {
    console.log("\n4) سجل البنزين داخل قسم البنزين");

    const key = (() => {
        const now = new Date();

        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    })();

    const now = new Date();

    const app = createApp({
        [STORAGE_KEY]: JSON.stringify({
            months: {
                [key]: {
                    year: now.getFullYear(),
                    month: now.getMonth(),
                    settings: {},
                    expenses: [],
                    homeExpenses: [],
                    carExpenses: [
                        { id: 11, kind: "fuel", title: "تعبئة بنزين", amount: 45000, total: 45000, liters: 100, pricePerLiter: 450, fuelType: "normal", date: now.toISOString() },
                        { id: 12, kind: "fuel", title: "تعبئة بنزين", amount: 8500, date: now.toISOString() },
                        { id: 13, kind: "maintenance", title: "صيانة عامة", amount: 60000, date: now.toISOString() }
                    ]
                }
            }
        })
    });

    app.renderCarPage();

    const fuelHtml = app.getElement("fuelRecordsList").innerHTML;
    const otherHtml = app.getElement("carExpensesList").innerHTML;

    check(
        (fuelHtml.match(/fuel-row/g) || []).length === 2,
        "سجل البنزين يعرض كل التعبئات القديمة (2)"
    );
    check(fuelHtml.indexOf("صيانة عامة") === -1, "سجل البنزين لا يعرض الصيانة");
    check(
        otherHtml.indexOf("fuel-row") === -1 && otherHtml.indexOf("صيانة عامة") !== -1,
        "سجل الصيانة لا يكرر البنزين"
    );
    check(
        app.getElement("fuelTotalAmount").textContent === app.currency(53500) &&
        app.getElement("fuelLogTotal").textContent === app.currency(53500),
        "إجمالي البنزين لم يتغير (53,500)"
    );
    check(
        app.getElement("carTotal").textContent === app.currency(113500),
        "إجمالي مصاريف السيارة كما كان (113,500)"
    );
    check(
        app.currentMonthData().carExpenses.length === 3,
        "لم تُحذف أي بيانات قديمة"
    );

    /* new fuel record still saves (formatted inputs) */
    app.openFuelModal();
    app.getElement("fuelTypeSelect").value = "other";
    app.getElement("fuelTypeSelect").dispatch("change");
    app.getElement("fuelLiters").value = "10";
    app.getElement("fuelPricePerLiter").value = "1,000";
    app.getElement("fuelPricePerLiter").disabled = false;
    app.getElement("fuelPricePerLiter").dispatch("input");

    check(app.getElement("fuelTotal").value === "10,000", "إجمالي التعبئة يُحسب ويظهر بالفواصل (10,000)");

    submit(app, "fuelForm");

    app.renderCarPage();

    check(app.getFuelRecords().length === 3, "عملية بنزين جديدة تُحفظ");
    check(
        app.getFuelRecords().slice(-1)[0].amount === 10000 &&
        app.getFuelRecords().slice(-1)[0].pricePerLiter === 1000,
        "المبلغ المحفوظ رقم حقيقي (10000)"
    );
    check(
        app.getElement("fuelTotalAmount").textContent === app.currency(63500),
        "الإجمالي بعد العملية الجديدة 63,500"
    );
}

/* =========================================================
   5) sync: wallet across devices
========================================================= */

const SYNC_SOURCE = fs.readFileSync(
    path.join(__dirname, "..", "firestore-sync.js"),
    "utf8"
);

const DEFAULT_SETTINGS = { loan: 425000, fuelBudget: 200000 };

function tick(ms = 30) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDevice(server, storage = {}) {
    const sandbox = {
        FIREBASE_CONFIG: {
            apiKey: "AIzaSyFakeKeyForTests0123456789",
            authDomain: "daftari-test.firebaseapp.com",
            projectId: "daftari-test",
            appId: "1:2:web:abc"
        },
        setTimeout,
        clearTimeout,
        console
    };

    sandbox.firebase = createClient(server);

    vm.createContext(sandbox);
    vm.runInContext(SYNC_SOURCE, sandbox, { filename: "firestore-sync.js" });

    const sync = sandbox.DaftariSync;

    const load = () => storage[STORAGE_KEY]
        ? JSON.parse(storage[STORAGE_KEY])
        : { months: {} };

    let database = load();

    const device = {
        sync,
        storage,
        get database() { return database; },
        commit() {
            sync.onLocalSave();
            storage[STORAGE_KEY] = JSON.stringify(database);
        },
        reload() { database = load(); },
        wallet() {
            return (database.savingsLedger && database.savingsLedger.walletTransactions) || [];
        }
    };

    device.ready = sync.init({
        getDatabase: () => database,
        createMonth: (year, month) => ({
            year, month, settings: Object.assign({}, DEFAULT_SETTINGS),
            savings: null, expenses: [], carExpenses: [], homeExpenses: [], tasks: []
        }),
        defaultSettings: DEFAULT_SETTINGS,
        persistLocal: () => { storage[STORAGE_KEY] = JSON.stringify(database); },
        onStatus() {},
        onAuthChange() {},
        onRemoteChange() {}
    });

    return device;
}

async function testWalletSync() {
    console.log("\n5) المحفظة والمزامنة");

    const server = createServer();

    const a = createDevice(server);
    await a.ready;

    a.database.savingsLedger = {
        transactions: [{ id: 1, type: "deposit", amount: 300000, date: "2026-09-01T10:00:00.000Z" }],
        debtors: []
    };
    a.commit();

    await a.sync.signUp("owner@daftari.test", "secret123");
    await a.sync.flushPending();
    await tick();

    const uid = a.sync.getUser().uid;

    a.database.savingsLedger.walletTransactions = [
        { id: 501, type: "deposit", amount: 100000, date: "2026-10-04T08:00:00.000Z", monthKey: "2026-10" },
        { id: 502, type: "withdraw", amount: 30000, date: "2026-10-04T09:00:00.000Z", monthKey: "2026-10" }
    ];
    a.commit();

    await a.sync.flushPending();
    await tick();

    const cloud = server.docs[`users/${uid}/meta/ledger`];

    check(
        Boolean(cloud) && Array.isArray(cloud.walletTransactions) && cloud.walletTransactions.length === 2,
        "المحفظة تُحفظ في Firestore (users/{uid}/meta/ledger)"
    );
    check(
        cloud.transactions.length === 1,
        "الادخار القديم في نفس المستند لم يتأثر"
    );

    /* second device, same account */
    const b = createDevice(server);
    await b.ready;
    await b.sync.signIn("owner@daftari.test", "secret123");
    await b.sync.flushPending();
    await tick();

    check(b.wallet().length === 2, "جهاز آخر بنفس الحساب يرى عمليات المحفظة");
    check(
        b.wallet().reduce((s, t) => s + (t.type === "deposit" ? t.amount : -t.amount), 0) === 70000,
        "جهاز آخر: رصيد المحفظة 70,000"
    );
    check(
        b.database.savingsLedger.transactions.length === 1,
        "جهاز آخر: الادخار القديم سليم"
    );

    /* logout / login keeps it */
    await a.sync.signOut();
    check(a.wallet().length === 2, "تسجيل الخروج لا يحذف المحفظة محلياً");

    await a.sync.signIn("owner@daftari.test", "secret123");
    await a.sync.flushPending();
    await tick();

    check(a.wallet().length === 2, "تسجيل الخروج ثم الدخول: المحفظة باقية");

    /* a new operation on B reaches A */
    b.database.savingsLedger.walletTransactions.push(
        { id: 503, type: "deposit", amount: 5000, date: "2026-10-04T10:00:00.000Z", monthKey: "2026-10" }
    );
    b.commit();
    await b.sync.flushPending();
    await tick(80);

    const cloudAfter = server.docs[`users/${uid}/meta/ledger`];

    check(cloudAfter.walletTransactions.length === 3, "عملية جديدة من جهاز ثانٍ تصل إلى Firestore");

    /* an older cloud ledger without wallet field never wipes local wallet data */
    const c = createDevice(createServer(), {
        [STORAGE_KEY]: JSON.stringify({
            months: {},
            savingsLedger: {
                transactions: [],
                debtors: [],
                walletTransactions: [{ id: 9, type: "deposit", amount: 1000, date: "2026-10-04T10:00:00.000Z", monthKey: "2026-10" }]
            }
        })
    });
    await c.ready;
    const collected = c.sync.collectData(c.database, DEFAULT_SETTINGS);

    check(
        collected.ledger && collected.ledger.walletTransactions.length === 1,
        "collectData: محفظة بدون ادخار تُرفع أيضاً"
    );
}

/* =========================================================
   RUN
========================================================= */

async function main() {
    console.log("DAFTARI - المحفظة / المواد المنزلية / الفواصل / سجل البنزين");

    try {
        testMoneyInputs();
        testWallet();
        testGroceries();
        testFuelLog();
        await testWalletSync();
    } catch (error) {
        failed += 1;
        console.log("\nUnexpected test error:");
        console.log(error && error.stack ? error.stack : error);
    }

    console.log(`\n${passed} passed, ${failed} failed`);

    process.exit(failed ? 1 : 0);
}

main();
