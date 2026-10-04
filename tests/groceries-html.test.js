/* =========================================================
   DAFTARI - المرحلة الرابعة: المواد المنزلية
   اختبار "عقد الواجهة" الحقيقي (index.html) مقابل الكود (script.js)

   اختبارات المنطق (الإضافة/الإجماليات/التخزين) موجودة في
   tests/wallet-home.test.js. هذا الملف يتأكد أن الواجهة الحقيقية
   تحتوي فعلاً على كل المعرّفات والأزرار التي يربطها script.js
   لقسم المواد المنزلية، حتى لا تنجح الوظيفة في اختبار الـDOM الوهمي
   بينما تكون الواجهة الحقيقية ناقصة.

   (run with: node tests/groceries-html.test.js)
========================================================== */

"use strict";

const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const SCRIPT = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");

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

const htmlIds = (HTML.match(/id="([^"]+)"/g) || [])
    .map((token) => token.slice(4, -1));

/* عناصر الصفحات الحقيقية التي يربطها script.js */
const PAGE_IDS = [
    "homeGroceriesTotal",        /* بطاقة البيت */
    "groceriesPage",             /* صفحة الأقسام الأربعة */
    "groceriesTotal",
    "groceryTotal_fruits",
    "groceryTotal_vegetables",
    "groceryTotal_meat",
    "groceryTotal_household",
    "groceryCategoryPage",       /* صفحة القسم */
    "groceryCategoryTitle",
    "groceryCategoryTotalLabel",
    "groceryCategoryTotal",
    "groceryTypeTabs",
    "groceryList",
    "addGroceryButton"
];

/* حقول نموذج الإضافة (تُبنى ديناميكياً داخل groceryFormHtml) */
const FORM_IDS = [
    "groceryForm",
    "groceryName",
    "groceryQuantity",
    "groceryUnit",
    "groceryUnitOther",
    "groceryUnitPrice",
    "groceryTotal",
    "groceryDate",
    "groceryNote"
];

console.log("عقد الواجهة - المواد المنزلية");

/* 1) كل عناصر الصفحات موجودة في index.html */
PAGE_IDS.forEach((id) => {
    check(htmlIds.indexOf(id) !== -1, `index.html يحتوي العنصر #${id}`);
});

/* 2) لا معرفات مكررة (getElementById يتأثر بالتكرار) */
const counts = {};

htmlIds.forEach((id) => {
    counts[id] = (counts[id] || 0) + 1;
});

const dups = Object.keys(counts).filter((id) => counts[id] > 1);

check(dups.length === 0, `لا توجد معرفات مكررة (${dups.join(", ") || "لا شيء"})`);

/* 3) حقول النموذج موجودة داخل groceryFormHtml في script.js */
FORM_IDS.forEach((id) => {
    check(
        SCRIPT.indexOf(`id="${id}"`) !== -1,
        `نموذج الإضافة يحتوي الحقل #${id}`
    );
});

/* 4) حقل سعر الوحدة يستخدم فواصل الآلاف (formatter المرحلة الأولى) */
const priceBlock = (SCRIPT.match(/id="groceryUnitPrice"[\s\S]{0,220}?>/) || [""])[0];
const quantityBlock = (SCRIPT.match(/id="groceryQuantity"[\s\S]{0,220}?>/) || [""])[0];

check(/data-money/.test(priceBlock), "سعر الوحدة (groceryUnitPrice) عليه data-money");
check(!/data-money/.test(quantityBlock), "الكمية (groceryQuantity) بدون تنسيق مبالغ");

/* 5) إجمالي الإدخال = الكمية × سعر الوحدة */
check(
    /function groceryComputedTotal\([\s\S]*?Math\.round\(quantity \* unitPrice\)/.test(SCRIPT),
    "الإجمالي يُحسب: الكمية × سعر الوحدة"
);

/* 6) الأقسام الأربعة في الكود تطابق أزرار الواجهة الحقيقية */
const groceryBlock = (SCRIPT.match(/const GROCERY_CATEGORIES = \{([\s\S]*?)\n\};/) || ["", ""])[1];

const codeKeys = (groceryBlock.match(/^\s{4}(\w+):\s*\{/gm) || [])
    .map((line) => line.trim().replace(/:\s*\{$/, ""));

const htmlGroups = (HTML.match(/data-grocery="([^"]+)"/g) || [])
    .map((token) => token.slice(14, -1));

check(
    codeKeys.join() === "fruits,vegetables,meat,household",
    "أقسام GROCERY_CATEGORIES: فواكه / خضروات / لحوم / مواد منزلية"
);

check(
    htmlGroups.slice().sort().join() === codeKeys.slice().sort().join(),
    `أزرار الواجهة تطابق الأقسام (${htmlGroups.join(", ")})`
);

/* 7) اللحوم: لحم / دجاج / سمك (قابل للتوسيع) */
check(
    /subtypes:\s*\["لحم",\s*"دجاج",\s*"سمك"\]/.test(SCRIPT),
    "اللحوم: الأنواع لحم / دجاج / سمك"
);

/* 8) وحدات المواد المنزلية قابلة للاختيار */
check(
    /لحوم[\s\S]*?household:\s*\{[\s\S]*?units:\s*\["قطعة",\s*"علبة",\s*"كارتون",\s*"لتر",\s*"كغم",\s*"أخرى"\]/.test(SCRIPT),
    "المواد المنزلية: قطعة/علبة/كارتون/لتر/كغم/أخرى"
);

/* 9) التنقل الحقيقي: بطاقة البيت تفتح صفحة المواد المنزلية */
check(
    HTML.indexOf('data-page="groceriesPage"') !== -1,
    "بطاقة البيت تفتح صفحة المواد المنزلية (data-page)"
);

check(
    /class="page"\s+id="groceriesPage"/.test(HTML) &&
        /class="page"\s+id="groceryCategoryPage"/.test(HTML),
    "الصفحتان الجديدتان من نوع .page (يعمل معها showPage)"
);

/* 10) التخزين داخل قائمة البيت الحالية بدون تغيير النظام */
check(
    /kind:\s*"grocery"/.test(SCRIPT) &&
        /homeExpenses\.push\(result\.record\)/.test(SCRIPT),
    "العمليات تُخزَّن داخل month.homeExpenses (نفس نظام البيت الحالي)"
);

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
    process.exitCode = 1;
}
