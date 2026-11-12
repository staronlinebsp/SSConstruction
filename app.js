
    (function () {
      "use strict";

      const STORAGE_KEYS = {
        COMPANY: "ss_inv_company_v2",
        CONTRACTS: "ss_inv_contracts_v2",
        HISTORY: "ss_inv_history_v2",
        EMPLOYEES: "ss_inv_employees_v1",
        ATTENDANCE: "ss_inv_attendance_v1",
        SALARY_HISTORY: "ss_inv_salary_hist_v1"
      };

      let company = loadFromStorage(STORAGE_KEYS.COMPANY, clone(window.SS_DEFAULT_COMPANY));
      let contracts = loadFromStorage(STORAGE_KEYS.CONTRACTS, clone(window.SS_DEFAULT_CONTRACTS));
      let history = loadFromStorage(STORAGE_KEYS.HISTORY, []);
      let employees = loadFromStorage(STORAGE_KEYS.EMPLOYEES, clone(window.SS_DEFAULT_EMPLOYEES));
      let attendanceStore = loadFromStorage(STORAGE_KEYS.ATTENDANCE, {});
      let salaryHistory = loadFromStorage(STORAGE_KEYS.SALARY_HISTORY, []);

      let activeMainView = "invoice";
      let invoiceState = createEmptyInvoiceState();
      let cmDraftItems = [];
      let cmDraftRecoveries = [];
      let pendingConfirmCallback = null;

      let payrollState = {
        monthYm: todayIso().slice(0, 7),
        docMode: "slip",
        contractFilter: "",
        employeeId: employees[0] ? employees[0].id : "",
        basicSalary: 18000,
        allowance: 2000,
        otHours: 0,
        otRate: 100,
        bonus: 0,
        advanceDed: 0,
        pfDed: 0,
        otherDed: 0,
        paymentMode: "Bank Transfer (NEFT/IMPS)",
        slipDateIso: todayIso(),
        remarks: "Salary credited for the month"
      };

      function clone(obj) {
        return JSON.parse(JSON.stringify(obj));
      }

      const revisions = window.__BOOT__.revisions;
      let writeQueue = Promise.resolve();
      let pendingWrites = 0;
      let saveFailed = false;
      function loadFromStorage(key, fallback) {
        return Object.prototype.hasOwnProperty.call(window.__BOOT__.data, key) ? clone(window.__BOOT__.data[key]) : fallback;
      }
      function saveToStorage(key, data) {
        if (saveFailed) { alert("Saving is paused after an error. Reload before making further changes."); return; }
        const snapshot = clone(data);
        pendingWrites++;
        const status = document.getElementById("syncStatus");
        status.textContent = "● Saving…";
        writeQueue = writeQueue.then(async () => {
          if (saveFailed) return;
          const {data: result, error} = await window.ssClient.rpc("save_workspace_data", {p_key:key, p_value:snapshot, p_expected_revision:revisions[key] || 0});
          if (error) throw new Error(error.code === "40001" ? "Another session changed this data. Reload to see the latest version; your unsaved changes may be lost." : "Could not save your changes. Check your connection and access, then reload.");
          revisions[key] = result;
        }).catch(err => {
          saveFailed = true; status.classList.add("error"); status.textContent = "● Save failed — reload";
          alert(err.message);
        }).finally(() => { pendingWrites--; if (!pendingWrites && !saveFailed) status.textContent = "● Saved"; });
      }
      window.addEventListener("beforeunload", e => { if (pendingWrites || saveFailed) { e.preventDefault(); e.returnValue = ""; } });

      function escapeHtml(str) {
        if (str === null || str === undefined) return "";
        return String(str)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      function round2(val) {
        return Math.round((Number(val) + Number.EPSILON) * 100) / 100;
      }

      function formatIndian(num, decimals = 2) {
        const n = Number(num);
        if (!Number.isFinite(n)) return (0).toFixed(decimals);
        const sign = n < 0 ? "-" : "";
        const abs = Math.abs(n);
        const fixed = abs.toFixed(decimals);
        const parts = fixed.split(".");
        let intPart = parts[0];
        const decPart = parts[1];

        if (intPart.length > 3) {
          const last3 = intPart.slice(-3);
          const rest = intPart.slice(0, -3);
          intPart = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
        }
        return sign + intPart + (decimals > 0 ? "." + decPart : "");
      }

      function money(n, decimals = 2) {
        return "₹ " + formatIndian(n || 0, decimals);
      }

      function numberToIndianWords(num) {
        const whole = Math.round(Math.abs(Number(num) || 0));
        if (whole === 0) return "Zero Rupees Only";

        const a = [
          "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
          "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
          "Seventeen", "Eighteen", "Nineteen"
        ];
        const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

        function under(n) {
          if (n < 20) return a[n];
          if (n < 100) return b[Math.floor(n / 10)] + (n % 10 ? " " + a[n % 10] : "");
          return a[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + under(n % 100) : "");
        }

        let n = whole;
        const out = [];
        const crore = Math.floor(n / 10000000);
        n %= 10000000;
        const lakh = Math.floor(n / 100000);
        n %= 100000;
        const thou = Math.floor(n / 1000);
        n %= 1000;
        const rem = n;

        if (crore) out.push(under(crore) + " Crore");
        if (lakh) out.push(under(lakh) + " Lakh");
        if (thou) out.push(under(thou) + " Thousand");
        if (rem) out.push(under(rem));

        return out.join(" ") + " Rupees Only";
      }

      function dmyToIso(dmy) {
        if (!dmy) return "";
        const m = String(dmy).trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
        if (!m) return "";
        return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
      }

      function isoToDmy(iso, sep = "/") {
        if (!iso) return "";
        const m = String(iso).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return "";
        return `${m[3]}${sep}${m[2]}${sep}${m[1]}`;
      }

      function todayIso() {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      }

      function parseIsoLocal(iso) {
        if (!iso) return null;
        const [y, m, d] = iso.split("-").map(Number);
        if (!y || !m || !d) return null;
        return new Date(y, m - 1, d);
      }

      function formatDateLocalIso(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
      }

      function addMonthsSafe(date, months) {
        const targetMonthIndex = date.getMonth() + months;
        const targetYear = date.getFullYear() + Math.floor(targetMonthIndex / 12);
        const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
        const daysInTarget = new Date(targetYear, normalizedMonth + 1, 0).getDate();
        const day = Math.min(date.getDate(), daysInTarget);
        return new Date(targetYear, normalizedMonth, day);
      }

      function computeNextCyclePeriod(prevStartIso, prevEndIso) {
        const end = parseIsoLocal(prevEndIso);
        if (!end) {
          const now = new Date();
          const s = new Date(now.getFullYear(), now.getMonth(), 1);
          const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
          return { startIso: formatDateLocalIso(s), endIso: formatDateLocalIso(e) };
        }
        const nextStart = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
        let nextEnd;
        if (nextStart.getDate() === 1) {
          nextEnd = new Date(nextStart.getFullYear(), nextStart.getMonth() + 1, 0);
        } else {
          const oneMonthAhead = addMonthsSafe(nextStart, 1);
          nextEnd = new Date(oneMonthAhead.getFullYear(), oneMonthAhead.getMonth(), oneMonthAhead.getDate() - 1);
        }
        return {
          startIso: formatDateLocalIso(nextStart),
          endIso: formatDateLocalIso(nextEnd)
        };
      }

      function formatNextSerial(num, fy) {
        const n = Number(num) || 1;
        const suffix = fy || company.financialYearSuffix || "2026-27";
        return `${n}/${suffix}`;
      }

      function parseSerialPrefix(sNo) {
        const m = String(sNo || "").match(/^(\d+)/);
        return m ? parseInt(m[1], 10) : null;
      }

      function showToast(msg) {
        const el = document.getElementById("toast");
        el.textContent = msg;
        el.classList.add("show");
        clearTimeout(showToast._timer);
        showToast._timer = setTimeout(() => el.classList.remove("show"), 2600);
      }

      function requestConfirmation(message, onConfirm) {
        pendingConfirmCallback = onConfirm;
        document.getElementById("confirmDialogMessage").textContent = message;
        openModal("confirmDialogModal");
      }

      // ==================== INVOICE STATE & CALCULATIONS ====================
      function createEmptyInvoiceState() {
        return {
          contractId: "",
          sNo: formatNextSerial((company.lastSerialNumber ?? 0) + 1),
          invoiceDateIso: todayIso(),
          billFromIso: "",
          billToIso: "",
          consignedTo: "",
          purchaserGstn: "",
          contractDisplay: "",
          woNo: "",
          vCode: "",
          contractPeriod: "",
          showVehicleInDesc: false,
          showRunningKmInDesc: false,
          vehicleNo: "",
          runningKmText: "",
          kmCap: 0,
          taxMode: "inclusive",
          gstType: "CGST_SGST",
          gstRate: 5,
          showTotalGstRow: false,
          showSignatoryBlock: false,
          overrideBasicCost: "",
          overrideRoundOff: "",
          items: [],
          recoveriesEnabled: false,
          recoveries: []
        };
      }

      function formatContractDisplay(c) {
        if (!c.contractDate) return c.contractNo || "";
        const lbl = c.contractDateLabel || "Dt.";
        return `${c.contractNo}, ${lbl} ${c.contractDate}`;
      }

      function selectContract(contractId, useLastBilledDates = false) {
        const c = contracts.find((x) => x.id === contractId) || contracts[0];
        if (!c) return;

        invoiceState.contractId = c.id;
        invoiceState.sNo = c.lastBill && useLastBilledDates
          ? c.lastBill.sNo
          : formatNextSerial((company.lastSerialNumber ?? 0) + 1);
        invoiceState.invoiceDateIso = c.lastBill && useLastBilledDates && dmyToIso(c.lastBill.date)
          ? dmyToIso(c.lastBill.date)
          : todayIso();

        if (c.lastBill && c.lastBill.periodStart && c.lastBill.periodEnd) {
          const prevS = dmyToIso(c.lastBill.periodStart);
          const prevE = dmyToIso(c.lastBill.periodEnd);
          if (useLastBilledDates) {
            invoiceState.billFromIso = prevS;
            invoiceState.billToIso = prevE;
          } else {
            const next = computeNextCyclePeriod(prevS, prevE);
            invoiceState.billFromIso = next.startIso;
            invoiceState.billToIso = next.endIso;
          }
        } else {
          const now = new Date();
          invoiceState.billFromIso = formatDateLocalIso(new Date(now.getFullYear(), now.getMonth(), 1));
          invoiceState.billToIso = formatDateLocalIso(new Date(now.getFullYear(), now.getMonth() + 1, 0));
        }

        invoiceState.consignedTo = c.consignedTo || "";
        invoiceState.purchaserGstn = c.purchaserGstn || "";
        invoiceState.contractDisplay = formatContractDisplay(c);
        invoiceState.woNo = c.woNo || "";
        invoiceState.vCode = c.vCode || "";
        invoiceState.contractPeriod = c.contractPeriod || "";
        invoiceState.showVehicleInDesc = Boolean(c.showVehicleInDesc);
        invoiceState.showRunningKmInDesc = Boolean(c.showRunningKmInDesc);
        invoiceState.vehicleNo = c.vehicleNo || "";
        invoiceState.runningKmText = c.defaultRunningKm || "0";
        invoiceState.kmCap = Number(c.kmCap || 0);
        invoiceState.taxMode = c.taxMode || "inclusive";
        invoiceState.gstType = c.gstType || "CGST_SGST";
        invoiceState.gstRate = Number(c.gstRate ?? 5);
        invoiceState.showTotalGstRow = Boolean(c.showTotalGstRow);
        invoiceState.showSignatoryBlock = Boolean(c.showSignatoryBlock);
        invoiceState.overrideBasicCost = "";
        invoiceState.overrideRoundOff = "";

        invoiceState.items = (c.items || []).map((item) => ({
          description: item.description || "",
          hsn: item.hsn || "",
          qty: item.qty !== undefined ? item.qty : 1,
          unit: item.unit || "Month",
          rate: item.rate !== undefined ? item.rate : 0,
          rateDecimals: item.rateDecimals !== undefined ? item.rateDecimals : 2,
          role: item.role || "other",
          manualAmount: ""
        }));

        invoiceState.recoveriesEnabled = Boolean(c.recoveriesEnabled);
        invoiceState.recoveries = (c.recoveries || []).map((r) => ({
          label: r.label || "",
          mode: r.mode || "percent_basic",
          value: r.value !== undefined ? r.value : 0,
          manualAmount: ""
        }));

        syncFormFromState();
        renderAll();
      }

      function calculateInvoiceTotals() {
        const computedItems = invoiceState.items.map((item) => {
          const qtyNum = Number(item.qty || 0);
          const rateNum = Number(item.rate || 0);
          const hasManual = item.manualAmount !== "" && item.manualAmount !== null && item.manualAmount !== undefined;
          const amt = hasManual ? round2(Number(item.manualAmount)) : round2(qtyNum * rateNum);
          return { ...item, computedAmount: amt };
        });

        const itemsTotal = round2(computedItems.reduce((acc, it) => acc + it.computedAmount, 0));
        const gstRate = Number(invoiceState.gstRate || 0);
        const hasBasicOverride = invoiceState.overrideBasicCost !== "" && invoiceState.overrideBasicCost !== null;
        const hasRoundOverride = invoiceState.overrideRoundOff !== "" && invoiceState.overrideRoundOff !== null;

        let basicCost = 0;
        let cgst = 0;
        let sgst = 0;
        let igst = 0;
        let totalGst = 0;
        let grandTotal = 0;

        if (invoiceState.taxMode === "inclusive") {
          const autoBasic = gstRate > 0 ? round2(itemsTotal / (1 + gstRate / 100)) : itemsTotal;
          basicCost = hasBasicOverride ? round2(Number(invoiceState.overrideBasicCost)) : autoBasic;
          if (invoiceState.gstType === "IGST") {
            igst = round2((basicCost * gstRate) / 100);
            totalGst = igst;
          } else {
            const half = gstRate / 2;
            cgst = round2((basicCost * half) / 100);
            sgst = round2((basicCost * half) / 100);
            totalGst = round2(cgst + sgst);
          }
          grandTotal = hasBasicOverride ? round2(basicCost + totalGst) : itemsTotal;
        } else {
          basicCost = hasBasicOverride ? round2(Number(invoiceState.overrideBasicCost)) : itemsTotal;
          if (invoiceState.gstType === "IGST") {
            igst = round2((basicCost * gstRate) / 100);
            totalGst = igst;
          } else {
            const half = gstRate / 2;
            cgst = round2((basicCost * half) / 100);
            sgst = round2((basicCost * half) / 100);
            totalGst = round2(cgst + sgst);
          }
          grandTotal = round2(basicCost + totalGst);
        }

        const roundOff = hasRoundOverride ? round2(Number(invoiceState.overrideRoundOff)) : Math.round(grandTotal);

        const computedRecoveries = (invoiceState.recoveriesEnabled ? invoiceState.recoveries : []).map((rec) => {
          const hasManual = rec.manualAmount !== "" && rec.manualAmount !== null && rec.manualAmount !== undefined;
          let amt = 0;
          if (hasManual) {
            amt = round2(Number(rec.manualAmount));
          } else if (rec.mode === "percent_basic") {
            amt = Math.round((basicCost * Number(rec.value || 0)) / 100);
          } else if (rec.mode === "percent_total") {
            amt = Math.round((grandTotal * Number(rec.value || 0)) / 100);
          } else {
            amt = round2(Number(rec.value || 0));
          }
          return { ...rec, computedAmount: amt };
        });

        const totalRecoveries = round2(computedRecoveries.reduce((acc, r) => acc + r.computedAmount, 0));
        const netPayable = round2(roundOff - totalRecoveries);

        return {
          computedItems,
          itemsTotal,
          basicCost,
          cgst,
          sgst,
          igst,
          totalGst,
          grandTotal,
          roundOff,
          computedRecoveries,
          totalRecoveries,
          netPayable
        };
      }

      // ==================== SYNC FORM UI ====================
      function populateContractSelect() {
        const sel = document.getElementById("contractSelect");
        const prevVal = invoiceState.contractId;
        sel.innerHTML = "";
        contracts.forEach((c) => {
          const opt = document.createElement("option");
          opt.value = c.id;
          opt.textContent = `${c.contractNo} — ${c.shortLabel}`;
          sel.appendChild(opt);
        });
        if (prevVal && contracts.some((c) => c.id === prevVal)) {
          sel.value = prevVal;
        } else if (contracts.length) {
          sel.value = contracts[0].id;
        }
        document.getElementById("contractCountBadge").textContent = String(contracts.length);
      }

      function renderContractMetaStrip() {
        const c = contracts.find((x) => x.id === invoiceState.contractId);
        const strip = document.getElementById("contractMetaStrip");
        if (!c) {
          strip.innerHTML = "";
          return;
        }
        const taxDesc = c.gstType === "IGST" ? `IGST @ ${c.gstRate}%` : `CGST+SGST @ ${c.gstRate}%`;
        const lastInfo = c.lastBill
          ? `Last Bill: <b>${escapeHtml(c.lastBill.sNo)}</b> (${escapeHtml(c.lastBill.periodStart)} To ${escapeHtml(c.lastBill.periodEnd)})`
          : "No previous bill saved";
        const assignedEmps = employees.filter((e) => e.contractId === c.id);
        const staffText = assignedEmps.length
          ? `Assigned Staff: <b>${assignedEmps.map((e) => escapeHtml(e.name)).join(", ")}</b>`
          : `Assigned Staff: <i>None</i>`;
        strip.innerHTML = `
          <span>GST: <b>${taxDesc}</b></span>
          <span>${lastInfo}</span>
          <span>${staffText}</span>
        `;
      }

      function syncFormFromState() {
        document.getElementById("contractSelect").value = invoiceState.contractId;
        renderContractMetaStrip();

        document.getElementById("invoiceSNo").value = invoiceState.sNo;
        document.getElementById("invoiceDate").value = invoiceState.invoiceDateIso;
        document.getElementById("billPeriodFrom").value = invoiceState.billFromIso;
        document.getElementById("billPeriodTo").value = invoiceState.billToIso;

        const showDescKm = invoiceState.showVehicleInDesc || invoiceState.showRunningKmInDesc;
        document.getElementById("descVehicleKmRow").style.display = showDescKm ? "grid" : "none";
        document.getElementById("descVehicleNo").value = invoiceState.vehicleNo;
        document.getElementById("descRunningKm").value = invoiceState.runningKmText;

        document.getElementById("invConsignedTo").value = invoiceState.consignedTo;
        document.getElementById("invPurchaserGstn").value = invoiceState.purchaserGstn;
        document.getElementById("invContractNo").value = invoiceState.contractDisplay;
        document.getElementById("invWoNo").value = invoiceState.woNo;
        document.getElementById("invVCode").value = invoiceState.vCode;
        document.getElementById("invContractPeriod").value = invoiceState.contractPeriod;

        const kmSplitBar = document.getElementById("kmSplitBar");
        if (invoiceState.kmCap > 0) {
          kmSplitBar.style.display = "flex";
          document.getElementById("kmCapLabel").textContent = String(invoiceState.kmCap);
          document.getElementById("quickTotalKmInput").value = "";
        } else {
          kmSplitBar.style.display = "none";
        }

        document.getElementById("taxMode").value = invoiceState.taxMode;
        document.getElementById("gstType").value = invoiceState.gstType;
        document.getElementById("gstRate").value = invoiceState.gstRate;
        document.getElementById("chkShowTotalGst").checked = invoiceState.showTotalGstRow;
        document.getElementById("chkShowSignatory").checked = invoiceState.showSignatoryBlock;
        document.getElementById("overrideBasicCost").value = invoiceState.overrideBasicCost;
        document.getElementById("overrideRoundOff").value = invoiceState.overrideRoundOff;

        document.getElementById("chkRecoveriesEnabled").checked = invoiceState.recoveriesEnabled;
        document.getElementById("recoveriesSectionBody").style.display = invoiceState.recoveriesEnabled ? "block" : "none";
        document.getElementById("recoveriesDisabledHint").style.display = invoiceState.recoveriesEnabled ? "none" : "block";

        renderLineItemsEditor();
        renderRecoveriesEditor();
      }

      function renderLineItemsEditor() {
        const container = document.getElementById("lineItemsContainer");
        container.innerHTML = "";
        const calc = calculateInvoiceTotals();

        invoiceState.items.forEach((item, idx) => {
          const box = document.createElement("div");
          box.className = "line-item-box";
          const calcAmt = calc.computedItems[idx].computedAmount;

          box.innerHTML = `
            <div class="line-item-head">
              <span class="line-badge">Item ${idx + 1}${item.role === "running_km" ? " · Running KM" : item.role === "extra_km" ? " · Extra KM" : ""}</span>
              ${invoiceState.items.length > 1 ? `<button type="button" class="btn-icon-del" data-del-item="${idx}" title="Remove Row">&times;</button>` : ""}
            </div>
            <div>
              <textarea rows="2" data-item-field="description" data-idx="${idx}" placeholder="Description of services...">${escapeHtml(item.description)}</textarea>
            </div>
            <div class="line-item-metrics">
              <div>
                <label>HSN</label>
                <input type="text" data-item-field="hsn" data-idx="${idx}" value="${escapeHtml(item.hsn)}" placeholder="996601" />
              </div>
              <div>
                <label>Qty / KM</label>
                <input type="number" step="any" data-item-field="qty" data-idx="${idx}" value="${item.qty}" />
              </div>
              <div>
                <label>Unit</label>
                <input type="text" data-item-field="unit" data-idx="${idx}" value="${escapeHtml(item.unit)}" placeholder="Month/Km" />
              </div>
              <div>
                <label>Rate (₹)</label>
                <input type="number" step="any" data-item-field="rate" data-idx="${idx}" value="${item.rate}" />
              </div>
              <div>
                <label>Amount (₹)</label>
                <input type="number" step="0.01" data-item-field="manualAmount" data-idx="${idx}" value="${item.manualAmount !== "" ? item.manualAmount : ""}" placeholder="${calcAmt.toFixed(2)}" />
              </div>
            </div>
          `;
          container.appendChild(box);
        });
      }

      function renderRecoveriesEditor() {
        const container = document.getElementById("recoveriesContainer");
        container.innerHTML = "";
        const calc = calculateInvoiceTotals();

        invoiceState.recoveries.forEach((rec, idx) => {
          const row = document.createElement("div");
          row.className = "recovery-row";
          const calcRec = calc.computedRecoveries[idx] ? calc.computedRecoveries[idx].computedAmount : 0;

          row.innerHTML = `
            <div>
              <label>Label</label>
              <input type="text" data-rec-field="label" data-idx="${idx}" value="${escapeHtml(rec.label)}" placeholder="2% IT" />
            </div>
            <div>
              <label>Rule</label>
              <select data-rec-field="mode" data-idx="${idx}">
                <option value="percent_basic" ${rec.mode === "percent_basic" ? "selected" : ""}>% of Basic</option>
                <option value="percent_total" ${rec.mode === "percent_total" ? "selected" : ""}>% of Total</option>
                <option value="fixed" ${rec.mode === "fixed" ? "selected" : ""}>Fixed ₹</option>
              </select>
            </div>
            <div>
              <label>${rec.mode === "fixed" ? "₹" : "%"}</label>
              <input type="number" step="any" data-rec-field="value" data-idx="${idx}" value="${rec.value}" />
            </div>
            <div>
              <label>Override ₹</label>
              <input type="number" step="0.01" data-rec-field="manualAmount" data-idx="${idx}" value="${rec.manualAmount !== "" ? rec.manualAmount : ""}" placeholder="${calcRec.toFixed(2)}" />
            </div>
            <button type="button" class="btn-icon-del" data-del-rec="${idx}" title="Remove Recovery">&times;</button>
          `;
          container.appendChild(row);
        });
      }

      // ==================== RENDER INVOICE PREVIEW ====================
      function renderAll() {
        const calc = calculateInvoiceTotals();
        renderInvoicePreview(calc);
      }

      function renderInvoicePreview(calc) {
        const paper = document.getElementById("invoicePaper");
        const dateStr = isoToDmy(invoiceState.invoiceDateIso, "/");
        const fromStr = isoToDmy(invoiceState.billFromIso, "/");
        const toStr = isoToDmy(invoiceState.billToIso, "/");
        const gstRate = Number(invoiceState.gstRate || 0);

        const rowsHtml = calc.computedItems
          .map((item, idx) => {
            const isFirst = idx === 0;
            let descHtml = escapeHtml(item.description);

            if (isFirst && (invoiceState.showVehicleInDesc || invoiceState.showRunningKmInDesc)) {
              const extraLines = [];
              if (invoiceState.showVehicleInDesc && invoiceState.vehicleNo) {
                extraLines.push(`Vehicle No. : ${escapeHtml(invoiceState.vehicleNo)}`);
              }
              if (invoiceState.showRunningKmInDesc && invoiceState.runningKmText !== "") {
                extraLines.push(`Running KM : ${escapeHtml(invoiceState.runningKmText)} KM`);
              }
              if (extraLines.length) {
                descHtml += `<br><br>${extraLines.join("<br>")}`;
              }
            }

            const qtyDisplay = item.qty !== "" && item.qty !== null
              ? `${item.qty}${item.unit ? " " + item.unit : ""}`
              : "";

            const rawRateStr = String(item.rate ?? "");
            const typedDecimals = rawRateStr.includes(".") ? Math.min(6, rawRateStr.split(".")[1].length) : 0;
            const rateDecimals = Math.max(
              item.rateDecimals !== undefined ? Number(item.rateDecimals) : 2,
              typedDecimals
            );

            const rateDisplay = item.rate !== "" && item.rate !== null
              ? money(item.rate, rateDecimals)
              : "";
            const amtDisplay = money(item.computedAmount, 2);

            return `
              <tr>
                <td>${idx + 1}.</td>
                <td>${escapeHtml(item.hsn)}</td>
                <td>${descHtml}</td>
                <td>${escapeHtml(qtyDisplay)}</td>
                <td>${rateDisplay}</td>
                <td>${amtDisplay}</td>
              </tr>
            `;
          })
          .join("");

        let summaryHtml = "";
        if (invoiceState.gstType === "IGST") {
          summaryHtml = `
            <tr><td>TOTAL</td><td>${money(calc.itemsTotal, 2)}</td></tr>
            <tr><td>Basic cost without GST</td><td>${money(calc.basicCost, 2)}</td></tr>
            <tr><td>IGST @${gstRate}%</td><td>${money(calc.igst, 2)}</td></tr>
            ${invoiceState.showTotalGstRow ? `<tr><td>Total GST</td><td>${money(calc.totalGst, 2)}</td></tr>` : ""}
            <tr><td><b>GRAND TOTAL</b></td><td><b>${money(calc.grandTotal, 2)}</b></td></tr>
            <tr><td>ROUND OFF</td><td>${money(calc.roundOff, 2)}</td></tr>
          `;
        } else {
          const half = gstRate / 2;
          summaryHtml = `
            <tr><td>TOTAL</td><td>${money(calc.itemsTotal, 2)}</td></tr>
            <tr><td>Basic cost without GST</td><td>${money(calc.basicCost, 2)}</td></tr>
            <tr><td>CGST @${half}%</td><td>${money(calc.cgst, 2)}</td></tr>
            <tr><td>SGST @${half}%</td><td>${money(calc.sgst, 2)}</td></tr>
            ${invoiceState.showTotalGstRow ? `<tr><td>Total GST</td><td>${money(calc.totalGst, 2)}</td></tr>` : ""}
            <tr><td><b>GRAND TOTAL</b></td><td><b>${money(calc.grandTotal, 2)}</b></td></tr>
            <tr><td>ROUND OFF</td><td>${money(calc.roundOff, 2)}</td></tr>
          `;
        }

        let recoveriesHtml = "";
        if (invoiceState.recoveriesEnabled && calc.computedRecoveries.length > 0) {
          const recLines = calc.computedRecoveries
            .map((r, i) => `${i + 1}&nbsp;&nbsp; ${escapeHtml(r.label)} &nbsp;&nbsp; ${money(r.computedAmount, 2)}`)
            .join("<br>");
          const finalNet = Math.round(calc.netPayable);
          recoveriesHtml = `
            <div class="recoveries">
              <b>Extra Recoveries:-</b><br>
              ${recLines}<br>
              <b>Total Amount after all deduction and recoveries = ${money(finalNet, 2)}</b><br>
              (${escapeHtml(numberToIndianWords(finalNet))})
            </div>
          `;
        }

        const signHtml = invoiceState.showSignatoryBlock
          ? `<div class="sign" style="line-height:1.4;">Digitally Signed by ${escapeHtml(company.proprietorEnglish)}<br>Authorised Signatory (For, ${escapeHtml(company.englishName)})</div>`
          : `<div class="sign">SIGNATURE</div>`;

        paper.innerHTML = `
          <div class="inv-title">TAX INVOICE</div>
          <div class="company">
            <h2>${escapeHtml(company.englishName)}</h2>
            <div>${escapeHtml(company.addressEnglishLine1)}<br>${escapeHtml(company.addressEnglishLine2)}</div>
            <div><b>PRO: ${escapeHtml(company.proprietorEnglish)}</b></div>
            <div>MSME: ${escapeHtml(company.msme)} &nbsp; | &nbsp; MOB: ${escapeHtml(company.phone)}</div>
            <div>Email: ${escapeHtml(company.emailEnglish)}</div>
          </div>
          <div class="meta">
            <div>
              <b>CONSIGNED TO :-</b> ${escapeHtml(invoiceState.consignedTo)}<br>
              <b>GSTN (Purchaser) :-</b> ${escapeHtml(invoiceState.purchaserGstn)}${invoiceState.woNo ? `<br><b>W.O. No. :-</b> ${escapeHtml(invoiceState.woNo)}${invoiceState.vCode ? ` &nbsp; <b>V. Code :</b> ${escapeHtml(invoiceState.vCode)}` : ""}` : ""}<br>
              <b>CONTRACT NO. :-</b> ${escapeHtml(invoiceState.contractDisplay)}${invoiceState.contractPeriod ? `<br><b>CONTRACT PERIOD :-</b> ${escapeHtml(invoiceState.contractPeriod)}` : ""}<br>
              <b>STATE :-</b> ${escapeHtml(company.stateLabel)}
            </div>
            <div style="text-align:right">
              <b>S. No. :</b> ${escapeHtml(invoiceState.sNo)}<br>
              <b>DATE :</b> ${escapeHtml(dateStr)}<br><br>
              <b>BILL PERIOD :-</b><br>${escapeHtml(fromStr)} To ${escapeHtml(toStr)}
            </div>
          </div>
          <table class="items">
            <thead>
              <tr>
                <th style="width:6%">S. No.</th>
                <th style="width:10%">HSN CODE</th>
                <th>DESCRIPTION OF SERVICES</th>
                <th style="width:13%">Trip/Month</th>
                <th style="width:13%">RATE</th>
                <th style="width:14%">AMOUNT</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
          <div class="bottom">
            <div class="bank">
              <b>Account Details :-</b><br>
              Name: ${escapeHtml(company.accountName)}<br>
              Account Number: ${escapeHtml(company.accountNumber)}<br>
              Bank: ${escapeHtml(company.bankName)}<br>
              IFSC: ${escapeHtml(company.ifsc)}<br>
              PAN: ${escapeHtml(company.pan)}<br>
              GSTN: ${escapeHtml(company.gstn)}
            </div>
            <table class="totals">${summaryHtml}</table>
          </div>
          <div class="words"><b>Amount (In words) :-</b> ${escapeHtml(numberToIndianWords(calc.roundOff))}</div>
          ${recoveriesHtml}
          ${signHtml}
        `;
      }

      // ==================== HISTORY & SAVING ====================
      function saveCurrentInvoice(silent = false) {
        const calc = calculateInvoiceTotals();
        const c = contracts.find((x) => x.id === invoiceState.contractId);

        const record = {
          id: "inv-" + Date.now(),
          savedAt: new Date().toISOString(),
          contractId: invoiceState.contractId,
          contractNo: c ? c.contractNo : invoiceState.contractDisplay,
          shortLabel: c ? c.shortLabel : invoiceState.consignedTo,
          sNo: invoiceState.sNo,
          dateDmy: isoToDmy(invoiceState.invoiceDateIso, "/"),
          periodStartDmy: isoToDmy(invoiceState.billFromIso, "/"),
          periodEndDmy: isoToDmy(invoiceState.billToIso, "/"),
          roundOff: calc.roundOff,
          netPayable: invoiceState.recoveriesEnabled ? calc.netPayable : calc.roundOff,
          stateSnapshot: clone(invoiceState)
        };

        const existingIdx = history.findIndex(
          (h) => h.sNo === record.sNo && h.contractId === record.contractId
        );
        if (existingIdx >= 0) {
          history[existingIdx] = record;
        } else {
          history.unshift(record);
        }
        saveToStorage(STORAGE_KEYS.HISTORY, history);

        if (c) {
          c.lastBill = {
            sNo: record.sNo,
            date: record.dateDmy,
            periodStart: record.periodStartDmy,
            periodEnd: record.periodEndDmy
          };
          saveToStorage(STORAGE_KEYS.CONTRACTS, contracts);
        }

        const serialNum = parseSerialPrefix(record.sNo);
        if (serialNum && serialNum > (company.lastSerialNumber || 0)) {
          company.lastSerialNumber = serialNum;
          saveToStorage(STORAGE_KEYS.COMPANY, company);
        }

        updateHistoryBadge();
        renderContractMetaStrip();
        if (!silent) {
          showToast(`Invoice ${record.sNo} queued for saving.`);
        }
        return record;
      }

      function updateHistoryBadge() {
        document.getElementById("historyCountBadge").textContent = String(history.length);
      }

      function triggerPrint() {
        const origTitle = document.title;
        if (activeMainView === "payroll") {
          const emp = employees.find((e) => e.id === payrollState.employeeId);
          const empPart = emp ? emp.name.replace(/[^a-zA-Z0-9]+/g, "_") : "Staff";
          document.title = payrollState.docMode === "muster"
            ? `Attendance_Muster_Roll_${payrollState.monthYm}`
            : `Salary_Slip_${empPart}_${payrollState.monthYm}`;
        } else {
          const c = contracts.find((x) => x.id === invoiceState.contractId);
          const shortPart = c ? c.shortLabel.split("—")[0].trim().replace(/[^a-zA-Z0-9]+/g, "_") : "Invoice";
          const sNoPart = String(invoiceState.sNo || "Bill").replace(/[^a-zA-Z0-9_-]+/g, "_");
          document.title = `Tax_Invoice_${sNoPart}_${shortPart}`;
        }
        window.print();
        setTimeout(() => {
          document.title = origTitle;
        }, 800);
      }

      // ==================== MAIN VIEW NAVIGATION ====================
      const routes = {dashboard:"#dashboard", invoice:"#invoices", contracts:"#contracts", employees:"#employees", payroll:"#payroll", settings:"#settings"};
      function renderDashboard() {
        document.getElementById("dashUser").textContent = window.__BOOT__.user.username;
        document.getElementById("dashInvoices").textContent = history.length;
        document.getElementById("dashContracts").textContent = contracts.length;
        document.getElementById("dashEmployees").textContent = employees.length;
        document.getElementById("dashSlips").textContent = salaryHistory.length;
        const target = document.getElementById("dashRecent");
        target.innerHTML = history.length ? '<div class="recent-list">' + history.slice(0,5).map(h => `<div class="recent-row"><span class="recent-icon">▤</span><div><strong>${escapeHtml(h.sNo || "Invoice")}</strong><small>${escapeHtml(h.shortLabel || h.contractNo || "Invoice")} · ${escapeHtml(h.dateDmy || "")}</small></div><b class="recent-amount">${money(h.roundOff || 0, 2)}</b></div>`).join("") + '</div>' : '<div class="empty-state">▤<b>No invoices yet</b>Your saved invoices will appear here.</div>';
      }
      function switchMainView(viewName, updateUrl = true) {
        if (!routes[viewName]) viewName = "dashboard";
        if (updateUrl && location.hash !== routes[viewName]) window.history.pushState({viewName}, "", routes[viewName]);
        if (viewName === "settings") {
          activeMainView = "invoice";
        } else {
          activeMainView = viewName;
        }

        document.querySelectorAll(".main-nav-btn").forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.mainView === viewName);
        });

        document.querySelectorAll(".app-view").forEach((v) => {
          v.classList.remove("active", "print-target");
        });

        if (viewName === "dashboard") {
          document.getElementById("view-dashboard").classList.add("active");
          document.getElementById("view-invoice").classList.add("print-target");
          renderDashboard();
        } else if (viewName === "invoice" || viewName === "settings") {
          const invView = document.getElementById("view-invoice");
          invView.classList.add("active", "print-target");
          switchLeftTab(viewName === "settings" ? "settings" : "builder");
        } else if (viewName === "contracts") {
          document.getElementById("view-contracts").classList.add("active");
          document.getElementById("view-invoice").classList.add("print-target");
          renderContractsPage();
        } else if (viewName === "employees") {
          document.getElementById("view-employees").classList.add("active");
          document.getElementById("view-invoice").classList.add("print-target");
          renderEmployeesPage();
        } else if (viewName === "payroll") {
          const payView = document.getElementById("view-payroll");
          payView.classList.add("active", "print-target");
          populatePayrollFilters();
          renderPayrollStudio();
        }
      }

      // ==================== CONTRACTS PAGE & STAFF ASSIGNMENT ====================
      function renderContractsPage() {
        const q = (document.getElementById("pageContractsSearch").value || "").toLowerCase().trim();
        const grid = document.getElementById("contractsPageGrid");
        const filtered = contracts.filter((c) => {
          if (!q) return true;
          return (
            c.contractNo.toLowerCase().includes(q) ||
            c.shortLabel.toLowerCase().includes(q) ||
            c.consignedTo.toLowerCase().includes(q) ||
            (c.vehicleNo || "").toLowerCase().includes(q)
          );
        });

        if (!filtered.length) {
          grid.innerHTML = `<p class="hint">No contracts match your search.</p>`;
          return;
        }

        grid.innerHTML = filtered
          .map((c) => {
            const assigned = employees.filter((e) => e.contractId === c.id);
            const firstItemRate = c.items && c.items[0] ? money(c.items[0].rate, 2) : "₹ 0.00";
            const staffChips = assigned.length
              ? assigned
                  .map(
                    (e) =>
                      `<span class="staff-chip">👷 ${escapeHtml(e.name)} <small style="color:var(--muted);">(${escapeHtml(e.role.split(" ")[0])})</small></span>`
                  )
                  .join("")
              : `<span style="color:var(--muted); font-size:11.5px;">No employee assigned yet</span>`;

            return `
              <div class="entity-card">
                <div>
                  <div class="entity-badge-row">
                    <span class="badge-tag">${escapeHtml(c.contractNo)}</span>
                    <span class="badge-tag ${c.gstType === "IGST" ? "orange" : "green"}">${c.gstType === "IGST" ? `IGST ${c.gstRate}%` : `CGST+SGST ${c.gstRate}%`}</span>
                  </div>
                  <h3 style="margin:8px 0 4px; font-size:15px; color:var(--navy);">${escapeHtml(c.shortLabel)}</h3>
                  <div style="font-size:12px; color:#475569; line-height:1.45; margin-bottom:8px;">
                    <b>Client:</b> ${escapeHtml(c.consignedTo)}<br>
                    ${c.vehicleNo ? `<b>Vehicle No.:</b> ${escapeHtml(c.vehicleNo)} &nbsp;|&nbsp; ` : ""}<b>Base Rate:</b> ${firstItemRate}
                  </div>
                  <div class="assigned-staff-box">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                      <b style="color:var(--navy);">Assigned Employees (${assigned.length})</b>
                      <button type="button" class="btn-link" data-card-edit-contract="${escapeHtml(c.id)}">+ Assign / Change</button>
                    </div>
                    <div class="staff-chip-list">${staffChips}</div>
                  </div>
                </div>
                <div class="btns" style="margin-top:4px;">
                  <button type="button" class="primary" data-card-bill-contract="${escapeHtml(c.id)}" style="padding:7px 11px; font-size:12px;">📄 Create Invoice</button>
                  <button type="button" class="secondary" data-card-payroll-contract="${escapeHtml(c.id)}" style="padding:7px 11px; font-size:12px;">🗓️ Staff Salary</button>
                  <button type="button" class="secondary" data-card-edit-contract="${escapeHtml(c.id)}" style="padding:7px 11px; font-size:12px;">Edit</button>
                </div>
              </div>
            `;
          })
          .join("");
      }

      // ==================== EMPLOYEES PAGE & CRUD ====================
      function updateEmployeeBadgesAndFilters() {
        document.getElementById("employeeCountBadge").textContent = String(employees.length);

        const empFilter = document.getElementById("empFilterContract");
        const prevFilter = empFilter.value;
        empFilter.innerHTML = `<option value="">All Contracts (${contracts.length})</option><option value="__unassigned__">Unassigned / Floater</option>`;
        contracts.forEach((c) => {
          const opt = document.createElement("option");
          opt.value = c.id;
          opt.textContent = `${c.shortLabel}`;
          empFilter.appendChild(opt);
        });
        empFilter.value = prevFilter;
      }

      function renderEmployeesPage() {
        updateEmployeeBadgesAndFilters();
        const q = (document.getElementById("pageEmployeesSearch").value || "").toLowerCase().trim();
        const cFilter = document.getElementById("empFilterContract").value;
        const grid = document.getElementById("employeesPageGrid");

        const filtered = employees.filter((e) => {
          if (cFilter === "__unassigned__" && e.contractId) return false;
          if (cFilter && cFilter !== "__unassigned__" && e.contractId !== cFilter) return false;
          if (!q) return true;
          return (
            (e.name || "").toLowerCase().includes(q) ||
            (e.code || "").toLowerCase().includes(q) ||
            (e.role || "").toLowerCase().includes(q) ||
            (e.phone || "").toLowerCase().includes(q) ||
            (e.vehicleNo || "").toLowerCase().includes(q)
          );
        });

        if (!filtered.length) {
          grid.innerHTML = `<p class="hint">No employees found. Click "+ Add New Employee" to add staff.</p>`;
          return;
        }

        grid.innerHTML = filtered
          .map((e) => {
            const c = contracts.find((x) => x.id === e.contractId);
            const contractLabel = c ? `${c.shortLabel} (${c.contractNo})` : "Unassigned / Floater";
            return `
              <div class="entity-card">
                <div>
                  <div class="entity-badge-row">
                    <span class="badge-tag purple">${escapeHtml(e.code || "EMP")}</span>
                    <span class="badge-tag green">${escapeHtml(e.role)}</span>
                  </div>
                  <h3 style="margin:8px 0 4px; font-size:16px; color:var(--navy);">👷 ${escapeHtml(e.name)}</h3>
                  <div style="font-size:12px; color:#475569; line-height:1.55;">
                    <b>Assigned Contract:</b> ${escapeHtml(contractLabel)}<br>
                    <b>Vehicle No.:</b> ${escapeHtml(e.vehicleNo || "N/A")} &nbsp;|&nbsp; <b>Mob:</b> ${escapeHtml(e.phone || "N/A")}<br>
                    <b>DL / ID:</b> ${escapeHtml(e.license || "N/A")}<br>
                    <b>Basic Salary:</b> ${money(e.basicSalary, 0)}/month &nbsp;|&nbsp; <b>Allowance:</b> ${money(e.allowance || 0, 0)}<br>
                    <b>Bank:</b> ${escapeHtml(e.bankName || "-")} (${escapeHtml(e.accountNo || "-")})
                  </div>
                </div>
                <div class="btns" style="margin-top:4px;">
                  <button type="button" class="orange" data-emp-salary="${escapeHtml(e.id)}" style="padding:7px 11px; font-size:12px;">🗓️ Attendance &amp; Salary Slip</button>
                  <button type="button" class="secondary" data-emp-edit="${escapeHtml(e.id)}" style="padding:7px 11px; font-size:12px;">Edit Profile</button>
                </div>
              </div>
            `;
          })
          .join("");
      }

      function openEmployeeModal(empToEdit = null) {
        const isEdit = Boolean(empToEdit);
        document.getElementById("employeeModalTitle").textContent = isEdit ? "Edit Employee" : "Add New Employee";
        document.getElementById("emDeleteBtn").style.display = isEdit ? "inline-flex" : "none";

        const contractSel = document.getElementById("emContractId");
        contractSel.innerHTML = `<option value="">-- Unassigned / Floater --</option>`;
        contracts.forEach((c) => {
          const opt = document.createElement("option");
          opt.value = c.id;
          opt.textContent = `${c.contractNo} — ${c.shortLabel}`;
          contractSel.appendChild(opt);
        });

        const nextNum = employees.length + 1;
        const emp = empToEdit || {
          id: "",
          code: `SSC-${String(nextNum).padStart(3, "0")}`,
          name: "",
          role: "Heavy Truck Driver",
          phone: "",
          license: "",
          joiningDate: todayIso(),
          contractId: contracts[0] ? contracts[0].id : "",
          vehicleNo: contracts[0] ? contracts[0].vehicleNo || "" : "",
          basicSalary: 18000,
          allowance: 2000,
          otRate: 100,
          pfDefault: 0,
          bankName: "",
          accountNo: "",
          ifsc: ""
        };

        document.getElementById("emId").value = emp.id || "";
        document.getElementById("emCode").value = emp.code || "";
        document.getElementById("emName").value = emp.name || "";
        document.getElementById("emRole").value = emp.role || "Heavy Truck Driver";
        document.getElementById("emPhone").value = emp.phone || "";
        document.getElementById("emLicense").value = emp.license || "";
        document.getElementById("emJoiningDate").value = emp.joiningDate || todayIso();
        document.getElementById("emContractId").value = emp.contractId || "";
        document.getElementById("emVehicleNo").value = emp.vehicleNo || "";
        document.getElementById("emBasicSalary").value = emp.basicSalary ?? 18000;
        document.getElementById("emAllowance").value = emp.allowance ?? 2000;
        document.getElementById("emOtRate").value = emp.otRate ?? 100;
        document.getElementById("emPfDefault").value = emp.pfDefault ?? 0;
        document.getElementById("emBankName").value = emp.bankName || "";
        document.getElementById("emAccountNo").value = emp.accountNo || "";
        document.getElementById("emIfsc").value = emp.ifsc || "";

        openModal("employeeModal");
      }

      function saveEmployeeFromModal() {
        const id = document.getElementById("emId").value.trim();
        const name = document.getElementById("emName").value.trim();
        const code = document.getElementById("emCode").value.trim();
        if (!name) {
          showToast("Please enter Employee Full Name.");
          return;
        }

        const empObj = {
          id: id || "emp-" + Date.now(),
          code: code || "EMP",
          name,
          role: document.getElementById("emRole").value,
          phone: document.getElementById("emPhone").value.trim(),
          license: document.getElementById("emLicense").value.trim(),
          joiningDate: document.getElementById("emJoiningDate").value,
          contractId: document.getElementById("emContractId").value,
          vehicleNo: document.getElementById("emVehicleNo").value.trim(),
          basicSalary: Number(document.getElementById("emBasicSalary").value || 0),
          allowance: Number(document.getElementById("emAllowance").value || 0),
          otRate: Number(document.getElementById("emOtRate").value || 0),
          pfDefault: Number(document.getElementById("emPfDefault").value || 0),
          bankName: document.getElementById("emBankName").value.trim(),
          accountNo: document.getElementById("emAccountNo").value.trim(),
          ifsc: document.getElementById("emIfsc").value.trim()
        };

        const existingIdx = employees.findIndex((e) => e.id === id);
        if (existingIdx >= 0) {
          employees[existingIdx] = empObj;
        } else {
          employees.push(empObj);
        }

        saveToStorage(STORAGE_KEYS.EMPLOYEES, employees);
        updateEmployeeBadgesAndFilters();
        renderEmployeesPage();
        renderContractsPage();
        renderContractMetaStrip();
        if (activeMainView === "payroll") {
          payrollState.employeeId = empObj.id;
          populatePayrollFilters();
          loadEmployeeIntoPayroll(empObj.id);
        }
        closeModal("employeeModal");
        showToast(existingIdx >= 0 ? "Employee updated!" : "New employee added!");
      }

      // ==================== ATTENDANCE & SALARY SLIP STUDIO ====================
      function getDaysInYm(ym) {
        const [y, m] = (ym || "2026-10").split("-").map(Number);
        return new Date(y || 2026, m || 10, 0).getDate();
      }

      function getAttendanceKey(empId, ym) {
        return `${empId}__${ym}`;
      }

      function getOrCreateMonthAttendance(empId, ym) {
        const key = getAttendanceKey(empId, ym);
        const daysInMonth = getDaysInYm(ym);
        if (!attendanceStore[key] || !Array.isArray(attendanceStore[key]) || attendanceStore[key].length !== daysInMonth) {
          const [y, m] = ym.split("-").map(Number);
          const arr = [];
          for (let d = 1; d <= daysInMonth; d++) {
            const dow = new Date(y, m - 1, d).getDay();
            arr.push(dow === 0 ? "WO" : "P");
          }
          attendanceStore[key] = arr;
          saveToStorage(STORAGE_KEYS.ATTENDANCE, attendanceStore);
        }
        return attendanceStore[key];
      }

      function populatePayrollFilters() {
        const cFilter = document.getElementById("payContractFilter");
        const prevCF = payrollState.contractFilter;
        cFilter.innerHTML = `<option value="">All Contracts (सभी कॉन्ट्रैक्ट्स)</option>`;
        contracts.forEach((c) => {
          const opt = document.createElement("option");
          opt.value = c.id;
          opt.textContent = `${c.contractNo} — ${c.shortLabel}`;
          cFilter.appendChild(opt);
        });
        cFilter.value = prevCF;

        const empSel = document.getElementById("payEmployeeSelect");
        const filteredEmps = employees.filter((e) => !payrollState.contractFilter || e.contractId === payrollState.contractFilter);
        empSel.innerHTML = "";
        filteredEmps.forEach((e) => {
          const c = contracts.find((x) => x.id === e.contractId);
          const opt = document.createElement("option");
          opt.value = e.id;
          opt.textContent = `${e.name} (${e.code}) — ${c ? c.shortLabel : "Unassigned"}`;
          empSel.appendChild(opt);
        });

        if (filteredEmps.length) {
          if (!filteredEmps.some((e) => e.id === payrollState.employeeId)) {
            payrollState.employeeId = filteredEmps[0].id;
          }
          empSel.value = payrollState.employeeId;
          loadEmployeeIntoPayroll(payrollState.employeeId);
        } else {
          renderPayrollStudio();
        }
        document.getElementById("salaryHistCount").textContent = String(salaryHistory.length);
      }

      function loadEmployeeIntoPayroll(empId) {
        const emp = employees.find((e) => e.id === empId);
        if (!emp) return;
        payrollState.employeeId = emp.id;
        payrollState.basicSalary = Number(emp.basicSalary || 0);
        payrollState.allowance = Number(emp.allowance || 0);
        payrollState.otRate = Number(emp.otRate || 0);
        payrollState.pfDed = Number(emp.pfDefault || 0);
        payrollState.otHours = 0;
        payrollState.bonus = 0;
        payrollState.advanceDed = 0;
        payrollState.otherDed = 0;

        document.getElementById("payBasicSalary").value = payrollState.basicSalary;
        document.getElementById("payAllowance").value = payrollState.allowance;
        document.getElementById("payOtHours").value = payrollState.otHours;
        document.getElementById("payOtRate").value = payrollState.otRate;
        document.getElementById("payBonus").value = payrollState.bonus;
        document.getElementById("payAdvanceDed").value = payrollState.advanceDed;
        document.getElementById("payPfDed").value = payrollState.pfDed;
        document.getElementById("payOtherDed").value = payrollState.otherDed;
        document.getElementById("paySlipDate").value = payrollState.slipDateIso;
        document.getElementById("payRemarks").value = payrollState.remarks;

        renderPayrollStudio();
      }

      function computeEmployeePayroll(emp, ym, customParams = null) {
        const daysInMonth = getDaysInYm(ym);
        const att = getOrCreateMonthAttendance(emp.id, ym);
        let countP = 0;
        let countA = 0;
        let countHD = 0;
        let countWO = 0;
        att.forEach((st) => {
          if (st === "P") countP++;
          else if (st === "A") countA++;
          else if (st === "HD") countHD++;
          else if (st === "WO") countWO++;
        });

        const payableDays = countP + countWO + countHD * 0.5;
        const baseSal = customParams ? Number(customParams.basicSalary || 0) : Number(emp.basicSalary || 0);
        const allow = customParams ? Number(customParams.allowance || 0) : Number(emp.allowance || 0);
        const otHrs = customParams ? Number(customParams.otHours || 0) : 0;
        const otRt = customParams ? Number(customParams.otRate || 0) : Number(emp.otRate || 0);
        const bonus = customParams ? Number(customParams.bonus || 0) : 0;
        const advDed = customParams ? Number(customParams.advanceDed || 0) : 0;
        const pfDed = customParams ? Number(customParams.pfDed || 0) : Number(emp.pfDefault || 0);
        const othDed = customParams ? Number(customParams.otherDed || 0) : 0;

        const perDayRate = daysInMonth > 0 ? baseSal / daysInMonth : 0;
        const earnedBasic = Math.round(perDayRate * payableDays);
        const earnedAllowance = Math.round((allow / daysInMonth) * payableDays);
        const otAmount = Math.round(otHrs * otRt);
        const grossEarnings = earnedBasic + earnedAllowance + otAmount + Math.round(bonus);
        const totalDeductions = Math.round(advDed + pfDed + othDed);
        const netPayable = Math.max(0, grossEarnings - totalDeductions);

        return {
          daysInMonth,
          att,
          countP,
          countA,
          countHD,
          countWO,
          payableDays,
          baseSal,
          allow,
          perDayRate,
          earnedBasic,
          earnedAllowance,
          otHrs,
          otRt,
          otAmount,
          bonus,
          grossEarnings,
          advDed,
          pfDed,
          othDed,
          totalDeductions,
          netPayable
        };
      }

      function renderPayrollStudio() {
        const emp = employees.find((e) => e.id === payrollState.employeeId);
        const gridEl = document.getElementById("attCalendarGrid");
        const pillsEl = document.getElementById("attSummaryPills");
        const paper = document.getElementById("payrollPaper");

        if (!emp) {
          gridEl.innerHTML = `<p class="hint" style="grid-column:1/-1;">No employee selected.</p>`;
          pillsEl.innerHTML = "";
          paper.innerHTML = `<p style="text-align:center; padding:40px;">Please select or add an employee.</p>`;
          return;
        }

        const ym = payrollState.monthYm || "2026-10";
        const [y, m] = ym.split("-").map(Number);
        const dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const calc = computeEmployeePayroll(emp, ym, payrollState);

        gridEl.innerHTML = calc.att
          .map((st, idx) => {
            const dayNum = idx + 1;
            const dow = dowNames[new Date(y, m - 1, dayNum).getDay()];
            return `
              <div class="att-day-cell att-status-${st}" data-att-day="${idx}" title="Click to toggle status">
                <span class="att-day-num">${dayNum}</span>
                <span class="att-day-dow">${dow}</span>
                <span class="att-day-status">${st}</span>
              </div>
            `;
          })
          .join("");

        pillsEl.innerHTML = `
          <div class="att-stat-box"><span>Present (P)</span><strong style="color:#166534;">${calc.countP}</strong></div>
          <div class="att-stat-box"><span>Weekly Off</span><strong style="color:#1e40af;">${calc.countWO}</strong></div>
          <div class="att-stat-box"><span>Half Day</span><strong style="color:#92400e;">${calc.countHD}</strong></div>
          <div class="att-stat-box"><span>Absent (A)</span><strong style="color:#991b1b;">${calc.countA}</strong></div>
          <div class="att-stat-box"><span>Payable Days</span><strong>${calc.payableDays}/${calc.daysInMonth}</strong></div>
        `;

        const monthNames = [
          "January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December"
        ];
        const monthDisplay = `${monthNames[(m || 1) - 1]} ${y}`;
        const c = contracts.find((x) => x.id === emp.contractId);

        if (payrollState.docMode === "muster") {
          renderMusterRollPreview(paper, ym, monthDisplay);
          return;
        }

        let dayHeaders1 = "";
        let dayVals1 = "";
        let dayHeaders2 = "";
        let dayVals2 = "";
        for (let d = 1; d <= calc.daysInMonth; d++) {
          const st = calc.att[d - 1];
          const dow = dowNames[new Date(y, m - 1, d).getDay()];
          if (d <= 16) {
            dayHeaders1 += `<th>${d}<br><span style="font-weight:normal;font-size:8.5px;">${dow}</span></th>`;
            dayVals1 += `<td style="font-weight:700;">${st}</td>`;
          } else {
            dayHeaders2 += `<th>${d}<br><span style="font-weight:normal;font-size:8.5px;">${dow}</span></th>`;
            dayVals2 += `<td style="font-weight:700;">${st}</td>`;
          }
        }

        paper.innerHTML = `
          <div class="inv-title">SALARY SLIP &amp; MONTHLY ATTENDANCE SHEET</div>
          <div class="company">
            <h2>${escapeHtml(company.englishName)}</h2>
            <div>${escapeHtml(company.addressEnglishLine1)}<br>${escapeHtml(company.addressEnglishLine2)}</div>
            <div><b>PRO: ${escapeHtml(company.proprietorEnglish)}</b></div>
            <div>MSME: ${escapeHtml(company.msme)} &nbsp; | &nbsp; MOB: ${escapeHtml(company.phone)} &nbsp; | &nbsp; GSTN: ${escapeHtml(company.gstn)}</div>
          </div>

          <div class="meta">
            <div>
              <b>EMPLOYEE NAME :-</b> ${escapeHtml(emp.name)} (${escapeHtml(emp.code)})<br>
              <b>DESIGNATION :-</b> ${escapeHtml(emp.role)}<br>
              <b>MOBILE / DL NO. :-</b> ${escapeHtml(emp.phone || "-")} / ${escapeHtml(emp.license || "-")}<br>
              <b>ASSIGNED CONTRACT :-</b> ${escapeHtml(c ? `${c.contractNo} (${c.shortLabel})` : "General / Floater")}<br>
              <b>VEHICLE NO. :-</b> ${escapeHtml(emp.vehicleNo || (c && c.vehicleNo) || "-")}
            </div>
            <div style="text-align:right">
              <b>SALARY MONTH :</b> ${escapeHtml(monthDisplay)}<br>
              <b>SLIP DATE :</b> ${escapeHtml(isoToDmy(payrollState.slipDateIso, "/"))}<br>
              <b>PAYMENT MODE :</b> ${escapeHtml(payrollState.paymentMode)}<br>
              <b>BANK A/C :</b> ${escapeHtml(emp.accountNo || "-")} (${escapeHtml(emp.bankName || "-")})<br>
              <b>IFSC :</b> ${escapeHtml(emp.ifsc || "-")}
            </div>
          </div>

          <div style="margin-top:8px; font-weight:700; font-size:12px;">
            1. MONTHLY ATTENDANCE RECORD (${escapeHtml(monthDisplay)} — Total Days: ${calc.daysInMonth})
          </div>
          <table class="print-att-grid">
            <thead><tr>${dayHeaders1}</tr></thead>
            <tbody><tr>${dayVals1}</tr></tbody>
          </table>
          ${dayHeaders2 ? `<table class="print-att-grid" style="margin-top:4px;"><thead><tr>${dayHeaders2}</tr></thead><tbody><tr>${dayVals2}</tr></tbody></table>` : ""}

          <div style="display:flex; justify-content:space-between; background:#eef2f6; border:1px solid #333; padding:6px 10px; margin-top:8px; font-size:11.5px; font-weight:700;">
            <span>Total Days: ${calc.daysInMonth}</span>
            <span>Present (P): ${calc.countP}</span>
            <span>Weekly Off (WO): ${calc.countWO}</span>
            <span>Half Day (HD): ${calc.countHD}</span>
            <span>Absent (A): ${calc.countA}</span>
            <span>Net Payable Days: ${calc.payableDays} Days</span>
          </div>

          <div style="margin-top:14px; font-weight:700; font-size:12px;">
            2. SALARY EARNINGS &amp; DEDUCTIONS BREAKDOWN
          </div>
          <table class="items" style="margin-top:6px;">
            <thead>
              <tr>
                <th style="width:36%;">EARNINGS (आय विवरण)</th>
                <th style="width:14%;">AMOUNT (₹)</th>
                <th style="width:36%;">DEDUCTIONS (कटौती विवरण)</th>
                <th style="width:14%;">AMOUNT (₹)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="text-align:left;">Basic Salary (Rate: ${money(calc.baseSal, 0)} for ${calc.payableDays} days)</td>
                <td style="text-align:right;">${money(calc.earnedBasic, 2)}</td>
                <td style="text-align:left;">Salary Advance Deduction</td>
                <td style="text-align:right;">${money(calc.advDed, 2)}</td>
              </tr>
              <tr>
                <td style="text-align:left;">Bhatta / Site Allowance (Fixed: ${money(calc.allow, 0)})</td>
                <td style="text-align:right;">${money(calc.earnedAllowance, 2)}</td>
                <td style="text-align:left;">PF / ESIC / Welfare Deduction</td>
                <td style="text-align:right;">${money(calc.pfDed, 2)}</td>
              </tr>
              <tr>
                <td style="text-align:left;">Overtime Charges (${calc.otHrs} units @ ${money(calc.otRt, 0)})</td>
                <td style="text-align:right;">${money(calc.otAmount, 2)}</td>
                <td style="text-align:left;">Other Deductions / Fine</td>
                <td style="text-align:right;">${money(calc.othDed, 2)}</td>
              </tr>
              <tr>
                <td style="text-align:left;">Incentive / Special Bonus</td>
                <td style="text-align:right;">${money(calc.bonus, 2)}</td>
                <td style="text-align:left;"></td>
                <td style="text-align:right;"></td>
              </tr>
              <tr style="background:#eef2f6; font-weight:700;">
                <td style="text-align:left;">GROSS EARNINGS (कुल वेतन)</td>
                <td style="text-align:right;">${money(calc.grossEarnings, 2)}</td>
                <td style="text-align:left;">TOTAL DEDUCTIONS (कुल कटौती)</td>
                <td style="text-align:right;">${money(calc.totalDeductions, 2)}</td>
              </tr>
            </tbody>
          </table>

          <div class="bottom" style="margin-top:14px;">
            <div class="bank">
              <b>Remarks / Note :-</b> ${escapeHtml(payrollState.remarks || "Nil")}<br>
              <b>Amount (In words) :-</b> ${escapeHtml(numberToIndianWords(calc.netPayable))}
            </div>
            <table class="totals">
              <tr><td>Gross Salary</td><td>${money(calc.grossEarnings, 2)}</td></tr>
              <tr><td>Less: Total Deductions</td><td>- ${money(calc.totalDeductions, 2)}</td></tr>
              <tr><td><b>NET SALARY PAYABLE</b></td><td><b>${money(calc.netPayable, 2)}</b></td></tr>
            </table>
          </div>

          <div style="display:flex; justify-content:space-between; margin-top:70px; padding:0 15px; font-weight:700;">
            <div>EMPLOYEE SIGNATURE</div>
            <div>AUTHORISED SIGNATORY<br><span style="font-size:11px; font-weight:normal;">For, ${escapeHtml(company.englishName)}</span></div>
          </div>
        `;
      }

      function renderMusterRollPreview(paper, ym, monthDisplay) {
        const daysInMonth = getDaysInYm(ym);
        const listEmps = employees.filter(
          (e) => !payrollState.contractFilter || e.contractId === payrollState.contractFilter
        );
        const filterC = contracts.find((x) => x.id === payrollState.contractFilter);

        let dayCols = "";
        for (let d = 1; d <= daysInMonth; d++) {
          dayCols += `<th>${d}</th>`;
        }

        let totalPayrollSum = 0;
        const rowsHtml = listEmps
          .map((e, i) => {
            const isSelected = e.id === payrollState.employeeId;
            const calc = computeEmployeePayroll(e, ym, isSelected ? payrollState : null);
            totalPayrollSum += calc.netPayable;
            const c = contracts.find((x) => x.id === e.contractId);
            const dayCells = calc.att.map((st) => `<td>${st}</td>`).join("");
            return `
              <tr>
                <td>${i + 1}</td>
                <td style="text-align:left; white-space:nowrap;"><b>${escapeHtml(e.name)}</b><br><span style="font-size:8.5px;">${escapeHtml(e.role)} | ${escapeHtml(e.vehicleNo || (c && c.vehicleNo) || "-")}</span></td>
                ${dayCells}
                <td><b>${calc.countP}</b></td>
                <td>${calc.countWO}</td>
                <td>${calc.countA}</td>
                <td><b>${calc.payableDays}</b></td>
                <td style="text-align:right;">${formatIndian(calc.netPayable, 0)}</td>
                <td></td>
              </tr>
            `;
          })
          .join("");

        paper.innerHTML = `
          <div class="inv-title">MONTHLY ATTENDANCE REGISTER &amp; SALARY MUSTER ROLL</div>
          <div class="company">
            <h2>${escapeHtml(company.englishName)}</h2>
            <div>${escapeHtml(company.addressEnglishLine1)}, ${escapeHtml(company.addressEnglishLine2)}</div>
            <div><b>MONTH: ${escapeHtml(monthDisplay.toUpperCase())}</b> &nbsp;|&nbsp; <b>CONTRACT: ${escapeHtml(filterC ? `${filterC.contractNo} (${filterC.shortLabel})` : "ALL CONTRACTS")}</b></div>
          </div>

          <table class="muster-table">
            <thead>
              <tr>
                <th style="width:22px;">#</th>
                <th style="text-align:left; min-width:115px;">Employee / Vehicle</th>
                ${dayCols}
                <th>P</th>
                <th>WO</th>
                <th>A</th>
                <th>Pay<br>Days</th>
                <th>Net Pay<br>(₹)</th>
                <th style="min-width:52px;">Sign</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>

          <div style="margin-top:12px; display:flex; justify-content:space-between; font-weight:700; font-size:12px;">
            <div>Total Employees: ${listEmps.length} &nbsp;|&nbsp; Legend: P = Present, WO = Weekly Off, HD = Half Day, A = Absent</div>
            <div>Total Net Salary Payable: ${money(totalPayrollSum, 2)}</div>
          </div>

          <div style="display:flex; justify-content:space-between; margin-top:65px; padding:0 15px; font-weight:700;">
            <div>SITE SUPERVISOR SIGNATURE</div>
            <div>PROPRIETOR / AUTHORISED SIGNATORY (${escapeHtml(company.englishName)})</div>
          </div>
        `;
      }

      // ==================== MODALS ====================
      function openModal(id) {
        document.getElementById(id).classList.add("open");
        document.getElementById(id).setAttribute("aria-hidden", "false");
      }

      function closeModal(id) {
        document.getElementById(id).classList.remove("open");
        document.getElementById(id).setAttribute("aria-hidden", "true");
      }

      function openContractModal(contractToEdit = null) {
        const isEdit = Boolean(contractToEdit);
        document.getElementById("contractModalTitle").textContent = isEdit ? "Edit Contract" : "Add New Contract";
        document.getElementById("cmDeleteBtn").style.display = isEdit ? "inline-flex" : "none";

        const c = contractToEdit || {
          id: "",
          shortLabel: "",
          contractNo: "GEMC-",
          contractDate: "",
          contractDateLabel: "Dt.",
          consignedTo: "",
          purchaserGstn: "22AAAGM0289C1ZT",
          woNo: "",
          vCode: "",
          contractPeriod: "",
          gstType: "CGST_SGST",
          gstRate: 5,
          taxMode: "inclusive",
          vehicleNo: "",
          kmCap: 0,
          showVehicleInDesc: false,
          showRunningKmInDesc: false,
          showTotalGstRow: false,
          showSignatoryBlock: false,
          items: [
            {
              description: "",
              hsn: "996601",
              qty: 1,
              unit: "Month",
              rate: 0,
              rateDecimals: 2,
              role: "fixed"
            }
          ],
          recoveriesEnabled: false,
          recoveries: []
        };

        document.getElementById("cmId").value = c.id || "";
        document.getElementById("cmShortLabel").value = c.shortLabel || "";
        document.getElementById("cmContractNo").value = c.contractNo || "";
        document.getElementById("cmContractDate").value = c.contractDate || "";
        document.getElementById("cmDateLabel").value = c.contractDateLabel || "Dt.";
        document.getElementById("cmConsignedTo").value = c.consignedTo || "";
        document.getElementById("cmPurchaserGstn").value = c.purchaserGstn || "";
        document.getElementById("cmWoNo").value = c.woNo || "";
        document.getElementById("cmVCode").value = c.vCode || "";
        document.getElementById("cmContractPeriod").value = c.contractPeriod || "";
        document.getElementById("cmGstType").value = c.gstType || "CGST_SGST";
        document.getElementById("cmGstRate").value = c.gstRate ?? 5;
        document.getElementById("cmTaxMode").value = c.taxMode || "inclusive";
        document.getElementById("cmVehicleNo").value = c.vehicleNo || "";
        document.getElementById("cmKmCap").value = c.kmCap || 0;
        document.getElementById("cmShowVehicleInDesc").checked = Boolean(c.showVehicleInDesc || c.showRunningKmInDesc);
        document.getElementById("cmShowTotalGst").checked = Boolean(c.showTotalGstRow);
        document.getElementById("cmShowSignatory").checked = Boolean(c.showSignatoryBlock);
        document.getElementById("cmRecoveriesEnabled").checked = Boolean(c.recoveriesEnabled);

        cmDraftItems = clone(c.items || []);
        cmDraftRecoveries = clone(c.recoveries || []);
        renderCmItems();
        renderCmRecoveries();
        renderCmEmployeeChecklist(c.id || "");
        openModal("contractModal");
      }

      function renderCmEmployeeChecklist(contractId) {
        const box = document.getElementById("cmEmployeeAssignList");
        if (!box) return;
        if (!employees.length) {
          box.innerHTML = `<span class="hint">No employees in directory yet.</span>`;
          return;
        }
        box.innerHTML = employees
          .map((e) => {
            const checked = contractId && e.contractId === contractId ? "checked" : "";
            return `
              <label class="check-label" style="font-weight:600;">
                <input type="checkbox" data-cm-emp-assign="${escapeHtml(e.id)}" ${checked} />
                <span>${escapeHtml(e.name)} <small style="color:var(--muted);">(${escapeHtml(e.role.split(" ")[0])})</small></span>
              </label>
            `;
          })
          .join("");
      }

      function renderCmItems() {
        const container = document.getElementById("cmItemsContainer");
        container.innerHTML = "";
        cmDraftItems.forEach((item, idx) => {
          const row = document.createElement("div");
          row.className = "cm-item-row";
          row.innerHTML = `
            <div class="cm-item-grid">
              <div>
                <label>Service Description</label>
                <textarea rows="2" data-cm-item="description" data-idx="${idx}">${escapeHtml(item.description)}</textarea>
              </div>
              <div>
                <label>HSN</label>
                <input type="text" data-cm-item="hsn" data-idx="${idx}" value="${escapeHtml(item.hsn)}" />
              </div>
              <div>
                <label>Qty</label>
                <input type="number" step="any" data-cm-item="qty" data-idx="${idx}" value="${item.qty}" />
              </div>
              <div>
                <label>Unit</label>
                <input type="text" data-cm-item="unit" data-idx="${idx}" value="${escapeHtml(item.unit)}" />
              </div>
              <div>
                <label>Rate (₹)</label>
                <input type="number" step="any" data-cm-item="rate" data-idx="${idx}" value="${item.rate}" />
              </div>
              <div>
                <label>Decimals</label>
                <input type="number" min="2" max="6" data-cm-item="rateDecimals" data-idx="${idx}" value="${item.rateDecimals ?? 2}" />
              </div>
              <div>
                <label>Role</label>
                <select data-cm-item="role" data-idx="${idx}">
                  <option value="fixed" ${item.role === "fixed" ? "selected" : ""}>Fixed</option>
                  <option value="running_km" ${item.role === "running_km" ? "selected" : ""}>Running KM</option>
                  <option value="extra_km" ${item.role === "extra_km" ? "selected" : ""}>Extra KM</option>
                  <option value="other" ${item.role === "other" ? "selected" : ""}>Other</option>
                </select>
              </div>
              <button type="button" class="btn-icon-del" data-cm-del-item="${idx}">&times;</button>
            </div>
          `;
          container.appendChild(row);
        });
      }

      function renderCmRecoveries() {
        const container = document.getElementById("cmRecoveriesContainer");
        container.innerHTML = "";
        cmDraftRecoveries.forEach((rec, idx) => {
          const row = document.createElement("div");
          row.className = "cm-item-row";
          row.innerHTML = `
            <div class="cm-rec-grid">
              <div>
                <label>Recovery Label</label>
                <input type="text" data-cm-rec="label" data-idx="${idx}" value="${escapeHtml(rec.label)}" placeholder="2% IT" />
              </div>
              <div>
                <label>Mode</label>
                <select data-cm-rec="mode" data-idx="${idx}">
                  <option value="percent_basic" ${rec.mode === "percent_basic" ? "selected" : ""}>% of Basic Cost</option>
                  <option value="percent_total" ${rec.mode === "percent_total" ? "selected" : ""}>% of Gross Total</option>
                  <option value="fixed" ${rec.mode === "fixed" ? "selected" : ""}>Fixed ₹ Amount</option>
                </select>
              </div>
              <div>
                <label>Value (% or ₹)</label>
                <input type="number" step="any" data-cm-rec="value" data-idx="${idx}" value="${rec.value}" />
              </div>
              <button type="button" class="btn-icon-del" data-cm-del-rec="${idx}">&times;</button>
            </div>
          `;
          container.appendChild(row);
        });
      }

      function saveContractFromModal() {
        const id = document.getElementById("cmId").value.trim();
        const contractNo = document.getElementById("cmContractNo").value.trim();
        const shortLabel = document.getElementById("cmShortLabel").value.trim();
        const consignedTo = document.getElementById("cmConsignedTo").value.trim();

        if (!contractNo || !shortLabel || !consignedTo) {
          showToast("Please fill Short Name, Contract No., and Consigned To.");
          return;
        }

        const showVehKm = document.getElementById("cmShowVehicleInDesc").checked;
        const existing = id ? contracts.find((c) => c.id === id) : null;

        const newContract = {
          id: id || "c-custom-" + Date.now(),
          shortLabel,
          contractNo,
          contractDate: document.getElementById("cmContractDate").value.trim(),
          contractDateLabel: document.getElementById("cmDateLabel").value,
          consignedTo,
          purchaserGstn: document.getElementById("cmPurchaserGstn").value.trim(),
          woNo: document.getElementById("cmWoNo").value.trim(),
          vCode: document.getElementById("cmVCode").value.trim(),
          contractPeriod: document.getElementById("cmContractPeriod").value.trim(),
          gstType: document.getElementById("cmGstType").value,
          gstRate: Number(document.getElementById("cmGstRate").value || 0),
          taxMode: document.getElementById("cmTaxMode").value,
          vehicleNo: document.getElementById("cmVehicleNo").value.trim(),
          defaultRunningKm: existing ? existing.defaultRunningKm || "0" : "0",
          kmCap: Number(document.getElementById("cmKmCap").value || 0),
          showVehicleInDesc: showVehKm,
          showRunningKmInDesc: showVehKm,
          showTotalGstRow: document.getElementById("cmShowTotalGst").checked,
          showSignatoryBlock: document.getElementById("cmShowSignatory").checked,
          items: clone(cmDraftItems),
          recoveriesEnabled: document.getElementById("cmRecoveriesEnabled").checked,
          recoveries: clone(cmDraftRecoveries),
          lastBill: existing ? existing.lastBill : null
        };

        if (existing) {
          const idx = contracts.findIndex((c) => c.id === id);
          contracts[idx] = newContract;
        } else {
          contracts.push(newContract);
        }

        document.querySelectorAll("#cmEmployeeAssignList [data-cm-emp-assign]").forEach((chk) => {
          const empId = chk.dataset.cmEmpAssign;
          const emp = employees.find((e) => e.id === empId);
          if (!emp) return;
          if (chk.checked) {
            emp.contractId = newContract.id;
            if (newContract.vehicleNo && !emp.vehicleNo) {
              emp.vehicleNo = newContract.vehicleNo;
            }
          } else if (emp.contractId === newContract.id) {
            emp.contractId = "";
          }
        });
        saveToStorage(STORAGE_KEYS.EMPLOYEES, employees);

        saveToStorage(STORAGE_KEYS.CONTRACTS, contracts);
        populateContractSelect();
        selectContract(newContract.id);
        closeModal("contractModal");
        renderContractsDirectory();
        renderContractsPage();
        renderEmployeesPage();
        showToast(existing ? "Contract & staff assignment updated!" : "New contract added!");
      }

      function renderContractsDirectory() {
        const query = (document.getElementById("contractsSearchInput").value || "").toLowerCase().trim();
        const list = document.getElementById("contractsDirectoryBody");
        const filtered = contracts.filter((c) => {
          if (!query) return true;
          return (
            c.contractNo.toLowerCase().includes(query) ||
            c.shortLabel.toLowerCase().includes(query) ||
            c.consignedTo.toLowerCase().includes(query) ||
            (c.vehicleNo || "").toLowerCase().includes(query)
          );
        });

        if (!filtered.length) {
          list.innerHTML = `<p class="hint">No matching contracts found.</p>`;
          return;
        }

        list.innerHTML = filtered
          .map(
            (c) => `
            <div class="dir-card">
              <div>
                <div class="dir-title">${escapeHtml(c.shortLabel)}</div>
                <div class="dir-sub">
                  <span><b>${escapeHtml(c.contractNo)}</b>${c.contractDate ? ` (${escapeHtml(c.contractDate)})` : ""}</span>
                  ${c.vehicleNo ? `<span>Vehicle: ${escapeHtml(c.vehicleNo)}</span>` : ""}
                  <span>${c.gstType === "IGST" ? `IGST ${c.gstRate}%` : `CGST+SGST ${c.gstRate}%`}</span>
                </div>
              </div>
              <div class="dir-actions">
                <button type="button" class="primary" data-dir-use="${escapeHtml(c.id)}">Use</button>
                <button type="button" class="secondary" data-dir-edit="${escapeHtml(c.id)}">Edit</button>
              </div>
            </div>
          `
          )
          .join("");
      }

      function renderHistoryList() {
        const query = (document.getElementById("historySearchInput").value || "").toLowerCase().trim();
        const body = document.getElementById("historyListBody");
        const filtered = history.filter((h) => {
          if (!query) return true;
          return (
            (h.sNo || "").toLowerCase().includes(query) ||
            (h.contractNo || "").toLowerCase().includes(query) ||
            (h.shortLabel || "").toLowerCase().includes(query) ||
            (h.periodStartDmy || "").toLowerCase().includes(query)
          );
        });

        const totalSum = filtered.reduce((acc, h) => acc + Number(h.roundOff || 0), 0);
        document.getElementById("historySummaryPill").textContent =
          `${filtered.length} Invoices · ${money(totalSum, 0)}`;

        if (!filtered.length) {
          body.innerHTML = `<p class="hint">No saved invoices yet. Click "Save Invoice" or "Print / Save PDF".</p>`;
          return;
        }

        body.innerHTML = filtered
          .map(
            (h) => `
            <div class="dir-card">
              <div>
                <div class="dir-title">S. No. ${escapeHtml(h.sNo)} — ${escapeHtml(h.shortLabel)}</div>
                <div class="dir-sub">
                  <span>Date: ${escapeHtml(h.dateDmy)}</span>
                  <span>Period: ${escapeHtml(h.periodStartDmy)} To ${escapeHtml(h.periodEndDmy)}</span>
                  <span><b>Bill: ${money(h.roundOff, 2)}</b></span>
                </div>
              </div>
              <div class="dir-actions">
                <button type="button" class="secondary" data-hist-load="${escapeHtml(h.id)}">Open</button>
                <button type="button" class="primary" data-hist-next="${escapeHtml(h.id)}">Next Month</button>
                <button type="button" class="btn-danger-outline" data-hist-del="${escapeHtml(h.id)}">&times;</button>
              </div>
            </div>
          `
          )
          .join("");
      }

      // ==================== SETTINGS TAB (FIRM PROFILE) ====================
      function switchLeftTab(tabName) {
        const isSettings = tabName === "settings";
        document.getElementById("tabBtnBuilder").classList.toggle("active", !isSettings);
        document.getElementById("tabBtnBuilder").setAttribute("aria-selected", String(!isSettings));
        document.getElementById("tabBtnSettings").classList.toggle("active", isSettings);
        document.getElementById("tabBtnSettings").setAttribute("aria-selected", String(isSettings));

        document.getElementById("tabPaneBuilder").classList.toggle("active", !isSettings);
        document.getElementById("tabPaneSettings").classList.toggle("active", isSettings);

        if (isSettings) {
          syncSettingsTabFromCompany();
        }
      }

      function syncSettingsTabFromCompany() {
        document.getElementById("stEnglishName").value = company.englishName || "";
        document.getElementById("stProprietorEn").value = company.proprietorEnglish || "";
        document.getElementById("stMsme").value = company.msme || "";
        document.getElementById("stPhone").value = company.phone || "";
        document.getElementById("stEmailEn").value = company.emailEnglish || "";
        document.getElementById("stAddr1").value = company.addressEnglishLine1 || "";
        document.getElementById("stAddr2").value = company.addressEnglishLine2 || "";
        document.getElementById("stState").value = company.stateLabel || "";
        document.getElementById("stAccName").value = company.accountName || "";
        document.getElementById("stAccNo").value = company.accountNumber || "";
        document.getElementById("stBankName").value = company.bankName || "";
        document.getElementById("stIfsc").value = company.ifsc || "";
        document.getElementById("stPan").value = company.pan || "";
        document.getElementById("stGstn").value = company.gstn || "";
        document.getElementById("stFySuffix").value = company.financialYearSuffix || "2026-27";
        document.getElementById("stLastSerial").value = company.lastSerialNumber ?? 74;
      }

      function readSettingsTabIntoCompany(savePersist = false) {
        company.englishName = document.getElementById("stEnglishName").value.trim();
        company.proprietorEnglish = document.getElementById("stProprietorEn").value.trim();
        company.msme = document.getElementById("stMsme").value.trim();
        company.phone = document.getElementById("stPhone").value.trim();
        company.emailEnglish = document.getElementById("stEmailEn").value.trim();
        company.addressEnglishLine1 = document.getElementById("stAddr1").value.trim();
        company.addressEnglishLine2 = document.getElementById("stAddr2").value.trim();
        company.stateLabel = document.getElementById("stState").value.trim();
        company.accountName = document.getElementById("stAccName").value.trim();
        company.accountNumber = document.getElementById("stAccNo").value.trim();
        company.bankName = document.getElementById("stBankName").value.trim();
        company.ifsc = document.getElementById("stIfsc").value.trim();
        company.pan = document.getElementById("stPan").value.trim();
        company.gstn = document.getElementById("stGstn").value.trim();
        company.financialYearSuffix = document.getElementById("stFySuffix").value.trim() || "2026-27";
        company.lastSerialNumber = Number(document.getElementById("stLastSerial").value || 0);

        if (savePersist) {
          saveToStorage(STORAGE_KEYS.COMPANY, company);
        }
        renderAll();
      }

      function saveCompanyFromModal() {
        company.englishName = document.getElementById("coEnglishName").value.trim();
        company.proprietorEnglish = document.getElementById("coProprietorEn").value.trim();
        company.msme = document.getElementById("coMsme").value.trim();
        company.phone = document.getElementById("coPhone").value.trim();
        company.emailEnglish = document.getElementById("coEmailEn").value.trim();
        company.addressEnglishLine1 = document.getElementById("coAddr1").value.trim();
        company.addressEnglishLine2 = document.getElementById("coAddr2").value.trim();
        company.accountName = document.getElementById("coAccName").value.trim();
        company.accountNumber = document.getElementById("coAccNo").value.trim();
        company.bankName = document.getElementById("coBankName").value.trim();
        company.ifsc = document.getElementById("coIfsc").value.trim();
        company.pan = document.getElementById("coPan").value.trim();
        company.gstn = document.getElementById("coGstn").value.trim();
        company.stateLabel = document.getElementById("coState").value.trim();
        company.financialYearSuffix = document.getElementById("coFySuffix").value.trim() || "2026-27";
        company.lastSerialNumber = Number(document.getElementById("coLastSerial").value || 0);

        saveToStorage(STORAGE_KEYS.COMPANY, company);
        syncSettingsTabFromCompany();
        closeModal("companyModal");
        renderAll();
        showToast("Firm & bank settings updated!");
      }

      // ==================== EVENT BINDINGS ====================
      function bindEvents() {
        document.getElementById("accountName").textContent = window.__BOOT__.user.username + " · " + window.__BOOT__.user.role;
        document.getElementById("logoutButton").addEventListener("click", async () => {
          if (pendingWrites || saveFailed) { alert("Resolve pending or failed saves before signing out."); return; }
          const {error} = await window.ssClient.auth.signOut();
          if (!error) location.replace("index.html"); else alert("Could not sign out. Please try again.");
        });
        document.querySelectorAll("[data-go]").forEach(btn => btn.addEventListener("click", () => switchMainView(btn.dataset.go)));
        document.getElementById("dashHistory").addEventListener("click", () => document.getElementById("btnOpenHistory").click());
        document.getElementById("dashBackup").addEventListener("click", () => document.getElementById("btnBackupRestore").click());
        window.addEventListener("popstate", () => switchMainView(Object.keys(routes).find(k => routes[k] === location.hash) || "dashboard", false));
        // Main Navigation Bar
        document.querySelectorAll(".main-nav-btn").forEach((btn) => {
          btn.addEventListener("click", () => switchMainView(btn.dataset.mainView));
        });

        // Quick Add Employee & Contract buttons
        document.getElementById("btnQuickNewEmployee").addEventListener("click", () => openEmployeeModal(null));
        document.getElementById("btnPageAddEmployee").addEventListener("click", () => openEmployeeModal(null));
        document.getElementById("btnPageAddContract").addEventListener("click", () => openContractModal(null));

        // Contracts Page Search & Card Actions
        document.getElementById("pageContractsSearch").addEventListener("input", renderContractsPage);
        document.getElementById("contractsPageGrid").addEventListener("click", (e) => {
          const billBtn = e.target.closest("[data-card-bill-contract]");
          const editBtn = e.target.closest("[data-card-edit-contract]");
          const payBtn = e.target.closest("[data-card-payroll-contract]");
          if (billBtn) {
            selectContract(billBtn.dataset.cardBillContract, false);
            switchMainView("invoice");
          } else if (editBtn) {
            const c = contracts.find((x) => x.id === editBtn.dataset.cardEditContract);
            if (c) openContractModal(c);
          } else if (payBtn) {
            payrollState.contractFilter = payBtn.dataset.cardPayrollContract;
            switchMainView("payroll");
          }
        });

        // Employees Page Search, Filter & Actions
        document.getElementById("pageEmployeesSearch").addEventListener("input", renderEmployeesPage);
        document.getElementById("empFilterContract").addEventListener("change", renderEmployeesPage);
        document.getElementById("employeesPageGrid").addEventListener("click", (e) => {
          const editBtn = e.target.closest("[data-emp-edit]");
          const salBtn = e.target.closest("[data-emp-salary]");
          if (editBtn) {
            const emp = employees.find((x) => x.id === editBtn.dataset.empEdit);
            if (emp) openEmployeeModal(emp);
          } else if (salBtn) {
            payrollState.contractFilter = "";
            payrollState.employeeId = salBtn.dataset.empSalary;
            switchMainView("payroll");
          }
        });

        // Employee Modal Events
        document.getElementById("emContractId").addEventListener("change", (e) => {
          const c = contracts.find((x) => x.id === e.target.value);
          if (c && c.vehicleNo) {
            document.getElementById("emVehicleNo").value = c.vehicleNo;
          }
        });
        document.getElementById("emSaveBtn").addEventListener("click", saveEmployeeFromModal);
        document.getElementById("emDeleteBtn").addEventListener("click", () => {
          const id = document.getElementById("emId").value;
          requestConfirmation("Delete this employee from the directory?", () => {
            employees = employees.filter((e) => e.id !== id);
            saveToStorage(STORAGE_KEYS.EMPLOYEES, employees);
            updateEmployeeBadgesAndFilters();
            renderEmployeesPage();
            renderContractsPage();
            closeModal("employeeModal");
            showToast("Employee deleted.");
          });
        });

        // Payroll & Attendance Studio Events
        document.getElementById("payMonthInput").addEventListener("change", (e) => {
          payrollState.monthYm = e.target.value || "2026-10";
          renderPayrollStudio();
        });
        document.getElementById("payDocMode").addEventListener("change", (e) => {
          payrollState.docMode = e.target.value;
          renderPayrollStudio();
        });
        document.getElementById("payContractFilter").addEventListener("change", (e) => {
          payrollState.contractFilter = e.target.value;
          populatePayrollFilters();
        });
        document.getElementById("payEmployeeSelect").addEventListener("change", (e) => {
          loadEmployeeIntoPayroll(e.target.value);
        });
        document.getElementById("btnEditCurrentEmp").addEventListener("click", () => {
          const emp = employees.find((e) => e.id === payrollState.employeeId);
          if (emp) openEmployeeModal(emp);
        });

        // Click Day Cell to Cycle P -> A -> HD -> WO
        document.getElementById("attCalendarGrid").addEventListener("click", (e) => {
          const cell = e.target.closest("[data-att-day]");
          if (!cell || !payrollState.employeeId) return;
          const dayIdx = Number(cell.dataset.attDay);
          const att = getOrCreateMonthAttendance(payrollState.employeeId, payrollState.monthYm);
          const order = ["P", "A", "HD", "WO"];
          const nextSt = order[(order.indexOf(att[dayIdx]) + 1) % order.length];
          att[dayIdx] = nextSt;
          saveToStorage(STORAGE_KEYS.ATTENDANCE, attendanceStore);
          renderPayrollStudio();
        });

        document.getElementById("btnAttAllPresent").addEventListener("click", () => {
          if (!payrollState.employeeId) return;
          const days = getDaysInYm(payrollState.monthYm);
          attendanceStore[getAttendanceKey(payrollState.employeeId, payrollState.monthYm)] = Array(days).fill("P");
          saveToStorage(STORAGE_KEYS.ATTENDANCE, attendanceStore);
          renderPayrollStudio();
        });

        document.getElementById("btnAttSundaysWo").addEventListener("click", () => {
          if (!payrollState.employeeId) return;
          const att = getOrCreateMonthAttendance(payrollState.employeeId, payrollState.monthYm);
          const [y, m] = payrollState.monthYm.split("-").map(Number);
          for (let d = 1; d <= att.length; d++) {
            if (new Date(y, m - 1, d).getDay() === 0) att[d - 1] = "WO";
          }
          saveToStorage(STORAGE_KEYS.ATTENDANCE, attendanceStore);
          renderPayrollStudio();
        });

        document.getElementById("btnAttResetMonth").addEventListener("click", () => {
          if (!payrollState.employeeId) return;
          delete attendanceStore[getAttendanceKey(payrollState.employeeId, payrollState.monthYm)];
          getOrCreateMonthAttendance(payrollState.employeeId, payrollState.monthYm);
          renderPayrollStudio();
        });

        const payNumericFields = [
          ["payBasicSalary", "basicSalary"],
          ["payAllowance", "allowance"],
          ["payOtHours", "otHours"],
          ["payOtRate", "otRate"],
          ["payBonus", "bonus"],
          ["payAdvanceDed", "advanceDed"],
          ["payPfDed", "pfDed"],
          ["payOtherDed", "otherDed"]
        ];
        payNumericFields.forEach(([elId, key]) => {
          document.getElementById(elId).addEventListener("input", (e) => {
            payrollState[key] = Number(e.target.value || 0);
            renderPayrollStudio();
          });
        });
        document.getElementById("payPaymentMode").addEventListener("change", (e) => {
          payrollState.paymentMode = e.target.value;
          renderPayrollStudio();
        });
        document.getElementById("paySlipDate").addEventListener("change", (e) => {
          payrollState.slipDateIso = e.target.value;
          renderPayrollStudio();
        });
        document.getElementById("payRemarks").addEventListener("input", (e) => {
          payrollState.remarks = e.target.value;
          renderPayrollStudio();
        });

        function saveCurrentSalarySlip(silent = false) {
          const emp = employees.find((e) => e.id === payrollState.employeeId);
          if (!emp) return;
          const calc = computeEmployeePayroll(emp, payrollState.monthYm, payrollState);
          const rec = {
            id: "sal-" + Date.now(),
            monthYm: payrollState.monthYm,
            employeeId: emp.id,
            employeeName: emp.name,
            employeeCode: emp.code,
            role: emp.role,
            payableDays: calc.payableDays,
            daysInMonth: calc.daysInMonth,
            netPayable: calc.netPayable,
            payrollSnapshot: clone(payrollState)
          };
          const existIdx = salaryHistory.findIndex(
            (s) => s.employeeId === rec.employeeId && s.monthYm === rec.monthYm
          );
          if (existIdx >= 0) salaryHistory[existIdx] = rec;
          else salaryHistory.unshift(rec);
          saveToStorage(STORAGE_KEYS.SALARY_HISTORY, salaryHistory);
          document.getElementById("salaryHistCount").textContent = String(salaryHistory.length);
          if (!silent) showToast(`Salary Slip saved for ${emp.name} (${payrollState.monthYm})!`);
        }

        document.getElementById("btnSaveSalarySlip").addEventListener("click", () => saveCurrentSalarySlip(false));
        document.getElementById("btnPrintSalarySlip").addEventListener("click", () => {
          saveCurrentSalarySlip(true);
          triggerPrint();
        });

        document.getElementById("btnOpenSalaryHistory").addEventListener("click", () => {
          const body = document.getElementById("salaryHistoryListBody");
          if (!salaryHistory.length) {
            body.innerHTML = `<p class="hint">No saved salary slips yet.</p>`;
          } else {
            body.innerHTML = salaryHistory
              .map(
                (s) => `
                <div class="dir-card">
                  <div>
                    <div class="dir-title">${escapeHtml(s.employeeName)} (${escapeHtml(s.employeeCode)}) — Month: ${escapeHtml(s.monthYm)}</div>
                    <div class="dir-sub">
                      <span>Role: ${escapeHtml(s.role)}</span>
                      <span>Payable Days: ${s.payableDays}/${s.daysInMonth}</span>
                      <span><b>Net Salary: ${money(s.netPayable, 2)}</b></span>
                    </div>
                  </div>
                  <div class="dir-actions">
                    <button type="button" class="primary" data-sal-load="${escapeHtml(s.id)}">Load Slip</button>
                  </div>
                </div>
              `
              )
              .join("");
          }
          openModal("salaryHistoryModal");
        });

        document.getElementById("salaryHistoryListBody").addEventListener("click", (e) => {
          const btn = e.target.closest("[data-sal-load]");
          if (!btn) return;
          const rec = salaryHistory.find((s) => s.id === btn.dataset.salLoad);
          if (rec && rec.payrollSnapshot) {
            payrollState = clone(rec.payrollSnapshot);
            document.getElementById("payMonthInput").value = payrollState.monthYm;
            document.getElementById("payDocMode").value = payrollState.docMode || "slip";
            populatePayrollFilters();
            closeModal("salaryHistoryModal");
            showToast(`Loaded Salary Slip for ${rec.employeeName}`);
          }
        });

        // Left Panel Tab Switching
        document.getElementById("tabBtnBuilder").addEventListener("click", () => switchLeftTab("builder"));
        document.getElementById("tabBtnSettings").addEventListener("click", () => switchLeftTab("settings"));
        document.getElementById("btnBackToBuilder").addEventListener("click", () => switchLeftTab("builder"));

        // Live Firm Profile Updates from Settings Tab
        const settingsFieldIds = [
          "stEnglishName", "stProprietorEn", "stMsme", "stPhone", "stEmailEn",
          "stAddr1", "stAddr2", "stState", "stAccName", "stAccNo",
          "stBankName", "stIfsc", "stPan", "stGstn", "stFySuffix", "stLastSerial"
        ];
        settingsFieldIds.forEach((id) => {
          document.getElementById(id).addEventListener("input", () => {
            readSettingsTabIntoCompany(true);
          });
        });

        document.getElementById("btnSaveFirmTab").addEventListener("click", () => {
          readSettingsTabIntoCompany(true);
          showToast("Firm Profile saved!");
        });

        document.getElementById("btnResetFirmTab").addEventListener("click", () => {
          requestConfirmation("Reset Firm Profile & Bank Details back to original SS Construction defaults?", () => {
            company = clone(window.SS_DEFAULT_COMPANY);
            saveToStorage(STORAGE_KEYS.COMPANY, company);
            syncSettingsTabFromCompany();
            renderAll();
            showToast("Default Firm Profile restored!");
          });
        });

        document.getElementById("contractSelect").addEventListener("change", (e) => {
          selectContract(e.target.value, false);
        });

        document.getElementById("invoiceSNo").addEventListener("input", (e) => {
          invoiceState.sNo = e.target.value;
          renderAll();
        });

        document.getElementById("btnNextSNo").addEventListener("click", () => {
          const curr = parseSerialPrefix(invoiceState.sNo);
          const next = curr ? curr + 1 : (company.lastSerialNumber ?? 0) + 1;
          invoiceState.sNo = formatNextSerial(next);
          document.getElementById("invoiceSNo").value = invoiceState.sNo;
          renderAll();
        });

        document.getElementById("invoiceDate").addEventListener("change", (e) => {
          invoiceState.invoiceDateIso = e.target.value;
          renderAll();
        });

        document.getElementById("billPeriodFrom").addEventListener("change", (e) => {
          invoiceState.billFromIso = e.target.value;
          renderAll();
        });

        document.getElementById("billPeriodTo").addEventListener("change", (e) => {
          invoiceState.billToIso = e.target.value;
          renderAll();
        });

        document.getElementById("btnNextCyclePeriod").addEventListener("click", () => {
          const next = computeNextCyclePeriod(invoiceState.billFromIso, invoiceState.billToIso);
          invoiceState.billFromIso = next.startIso;
          invoiceState.billToIso = next.endIso;
          document.getElementById("billPeriodFrom").value = next.startIso;
          document.getElementById("billPeriodTo").value = next.endIso;
          renderAll();
        });

        document.getElementById("btnLastBilledPeriod").addEventListener("click", () => {
          selectContract(invoiceState.contractId, true);
          showToast("Loaded last billed dates & values.");
        });

        document.getElementById("btnCurrentCalendarMonth").addEventListener("click", () => {
          const ref = parseIsoLocal(invoiceState.invoiceDateIso) || new Date();
          const prevMonth = new Date(ref.getFullYear(), ref.getMonth() - 1, 1);
          const endPrevMonth = new Date(ref.getFullYear(), ref.getMonth(), 0);
          invoiceState.billFromIso = formatDateLocalIso(prevMonth);
          invoiceState.billToIso = formatDateLocalIso(endPrevMonth);
          document.getElementById("billPeriodFrom").value = invoiceState.billFromIso;
          document.getElementById("billPeriodTo").value = invoiceState.billToIso;
          renderAll();
        });

        document.getElementById("descVehicleNo").addEventListener("input", (e) => {
          invoiceState.vehicleNo = e.target.value;
          renderAll();
        });

        document.getElementById("descRunningKm").addEventListener("input", (e) => {
          invoiceState.runningKmText = e.target.value;
          renderAll();
        });

        const overrideMap = [
          ["invConsignedTo", "consignedTo"],
          ["invPurchaserGstn", "purchaserGstn"],
          ["invContractNo", "contractDisplay"],
          ["invWoNo", "woNo"],
          ["invVCode", "vCode"],
          ["invContractPeriod", "contractPeriod"]
        ];
        overrideMap.forEach(([elId, key]) => {
          document.getElementById(elId).addEventListener("input", (e) => {
            invoiceState[key] = e.target.value;
            renderAll();
          });
        });

        document.getElementById("btnApplyKmSplit").addEventListener("click", () => {
          const totalKm = Number(document.getElementById("quickTotalKmInput").value);
          if (!Number.isFinite(totalKm) || totalKm < 0) {
            showToast("Enter a valid total KM.");
            return;
          }
          const cap = Number(invoiceState.kmCap || 0);
          const runIdx = invoiceState.items.findIndex((i) => i.role === "running_km");
          const extraIdx = invoiceState.items.findIndex((i) => i.role === "extra_km");
          if (runIdx >= 0) {
            invoiceState.items[runIdx].qty = cap > 0 ? Math.min(totalKm, cap) : totalKm;
            invoiceState.items[runIdx].manualAmount = "";
          }
          if (extraIdx >= 0) {
            invoiceState.items[extraIdx].qty = cap > 0 ? Math.max(0, totalKm - cap) : 0;
            invoiceState.items[extraIdx].manualAmount = "";
          }
          renderLineItemsEditor();
          renderAll();
        });

        const lineContainer = document.getElementById("lineItemsContainer");
        lineContainer.addEventListener("input", (e) => {
          const field = e.target.dataset.itemField;
          const idx = Number(e.target.dataset.idx);
          if (!field || Number.isNaN(idx) || !invoiceState.items[idx]) return;
          invoiceState.items[idx][field] = e.target.value;
          if (field === "qty" || field === "rate") {
            const calc = calculateInvoiceTotals();
            const amtInput = lineContainer.querySelector(`input[data-item-field="manualAmount"][data-idx="${idx}"]`);
            if (amtInput && calc.computedItems[idx]) {
              amtInput.placeholder = calc.computedItems[idx].computedAmount.toFixed(2);
            }
          }
          renderAll();
        });

        lineContainer.addEventListener("click", (e) => {
          const delBtn = e.target.closest("[data-del-item]");
          if (!delBtn) return;
          invoiceState.items.splice(Number(delBtn.dataset.delItem), 1);
          renderLineItemsEditor();
          renderAll();
        });

        document.getElementById("btnAddLineItem").addEventListener("click", () => {
          invoiceState.items.push({
            description: "Extra Charges",
            hsn: "996601",
            qty: 1,
            unit: "Month",
            rate: 0,
            rateDecimals: 2,
            role: "other",
            manualAmount: ""
          });
          renderLineItemsEditor();
          renderAll();
        });

        document.getElementById("taxMode").addEventListener("change", (e) => {
          invoiceState.taxMode = e.target.value;
          renderAll();
        });

        document.getElementById("gstType").addEventListener("change", (e) => {
          invoiceState.gstType = e.target.value;
          renderAll();
        });

        document.getElementById("gstRate").addEventListener("input", (e) => {
          invoiceState.gstRate = Number(e.target.value || 0);
          renderAll();
        });

        document.getElementById("chkShowTotalGst").addEventListener("change", (e) => {
          invoiceState.showTotalGstRow = e.target.checked;
          renderAll();
        });

        document.getElementById("chkShowSignatory").addEventListener("change", (e) => {
          invoiceState.showSignatoryBlock = e.target.checked;
          renderAll();
        });

        document.getElementById("overrideBasicCost").addEventListener("input", (e) => {
          invoiceState.overrideBasicCost = e.target.value;
          renderAll();
        });

        document.getElementById("overrideRoundOff").addEventListener("input", (e) => {
          invoiceState.overrideRoundOff = e.target.value;
          renderAll();
        });

        document.getElementById("chkRecoveriesEnabled").addEventListener("change", (e) => {
          invoiceState.recoveriesEnabled = e.target.checked;
          document.getElementById("recoveriesSectionBody").style.display = e.target.checked ? "block" : "none";
          document.getElementById("recoveriesDisabledHint").style.display = e.target.checked ? "none" : "block";
          if (e.target.checked && invoiceState.recoveries.length === 0) {
            invoiceState.recoveries.push(
              { label: "2% IT", mode: "percent_basic", value: 2, manualAmount: "" },
              { label: "2% TDS-GST", mode: "percent_basic", value: 2, manualAmount: "" }
            );
            renderRecoveriesEditor();
          }
          renderAll();
        });

        document.getElementById("btnAddRecovery").addEventListener("click", () => {
          invoiceState.recoveriesEnabled = true;
          document.getElementById("chkRecoveriesEnabled").checked = true;
          document.getElementById("recoveriesSectionBody").style.display = "block";
          document.getElementById("recoveriesDisabledHint").style.display = "none";
          invoiceState.recoveries.push({
            label: "Cost of Bill Copy",
            mode: "fixed",
            value: 50,
            manualAmount: ""
          });
          renderRecoveriesEditor();
          renderAll();
        });

        const recContainer = document.getElementById("recoveriesContainer");
        recContainer.addEventListener("input", handleRecoveryChange);
        recContainer.addEventListener("change", handleRecoveryChange);
        function handleRecoveryChange(e) {
          const field = e.target.dataset.recField;
          const idx = Number(e.target.dataset.idx);
          if (!field || Number.isNaN(idx) || !invoiceState.recoveries[idx]) return;
          invoiceState.recoveries[idx][field] = e.target.value;
          if (field === "mode") {
            renderRecoveriesEditor();
          }
          renderAll();
        }

        recContainer.addEventListener("click", (e) => {
          const del = e.target.closest("[data-del-rec]");
          if (!del) return;
          invoiceState.recoveries.splice(Number(del.dataset.delRec), 1);
          renderRecoveriesEditor();
          renderAll();
        });

        // Buttons
        document.getElementById("btnResetInvoice").addEventListener("click", () => {
          selectContract(invoiceState.contractId, false);
          showToast("Form reset to contract defaults.");
        });

        document.getElementById("btnSaveOnly").addEventListener("click", () => {
          saveCurrentInvoice(false);
        });

        document.getElementById("btnSaveAndPrint").addEventListener("click", () => {
          saveCurrentInvoice(true);
          triggerPrint();
        });

        document.getElementById("btnTopPrint").addEventListener("click", triggerPrint);

        // Contract Modals
        document.getElementById("btnQuickNewContract").addEventListener("click", () => openContractModal(null));
        document.getElementById("btnAddContractInline").addEventListener("click", () => openContractModal(null));
        document.getElementById("btnNewContractFromDir").addEventListener("click", () => {
          closeModal("contractsListModal");
          openContractModal(null);
        });
        document.getElementById("btnEditSelectedContract").addEventListener("click", () => {
          const c = contracts.find((x) => x.id === invoiceState.contractId);
          if (c) openContractModal(c);
        });

        document.getElementById("cmAddItemBtn").addEventListener("click", () => {
          cmDraftItems.push({
            description: "",
            hsn: "996601",
            qty: 1,
            unit: "Month",
            rate: 0,
            rateDecimals: 2,
            role: "other"
          });
          renderCmItems();
        });

        const cmItemsEl = document.getElementById("cmItemsContainer");
        cmItemsEl.addEventListener("input", handleCmItemInput);
        cmItemsEl.addEventListener("change", handleCmItemInput);
        function handleCmItemInput(e) {
          const field = e.target.dataset.cmItem;
          const idx = Number(e.target.dataset.idx);
          if (!field || Number.isNaN(idx)) return;
          cmDraftItems[idx][field] =
            field === "qty" || field === "rate" || field === "rateDecimals"
              ? Number(e.target.value)
              : e.target.value;
        }
        cmItemsEl.addEventListener("click", (e) => {
          const del = e.target.closest("[data-cm-del-item]");
          if (!del) return;
          cmDraftItems.splice(Number(del.dataset.cmDelItem), 1);
          renderCmItems();
        });

        document.getElementById("cmAddRecoveryBtn").addEventListener("click", () => {
          document.getElementById("cmRecoveriesEnabled").checked = true;
          cmDraftRecoveries.push({ label: "2% IT", mode: "percent_basic", value: 2 });
          renderCmRecoveries();
        });

        const cmRecEl = document.getElementById("cmRecoveriesContainer");
        cmRecEl.addEventListener("input", handleCmRecInput);
        cmRecEl.addEventListener("change", handleCmRecInput);
        function handleCmRecInput(e) {
          const field = e.target.dataset.cmRec;
          const idx = Number(e.target.dataset.idx);
          if (!field || Number.isNaN(idx)) return;
          cmDraftRecoveries[idx][field] = field === "value" ? Number(e.target.value) : e.target.value;
        }
        cmRecEl.addEventListener("click", (e) => {
          const del = e.target.closest("[data-cm-del-rec]");
          if (!del) return;
          cmDraftRecoveries.splice(Number(del.dataset.cmDelRec), 1);
          renderCmRecoveries();
        });

        document.getElementById("cmSaveBtn").addEventListener("click", saveContractFromModal);
        document.getElementById("cmDeleteBtn").addEventListener("click", () => {
          const id = document.getElementById("cmId").value;
          if (contracts.length <= 1) {
            showToast("At least one contract must remain.");
            return;
          }
          requestConfirmation("Are you sure you want to delete this contract?", () => {
            contracts = contracts.filter((c) => c.id !== id);
            saveToStorage(STORAGE_KEYS.CONTRACTS, contracts);
            populateContractSelect();
            selectContract(contracts[0]?.id);
            closeModal("contractModal");
            renderContractsDirectory();
            renderContractsPage();
            showToast("Contract deleted.");
          });
        });

        document.getElementById("contractsSearchInput").addEventListener("input", renderContractsDirectory);
        document.getElementById("contractsDirectoryBody").addEventListener("click", (e) => {
          const useBtn = e.target.closest("[data-dir-use]");
          const editBtn = e.target.closest("[data-dir-edit]");
          if (useBtn) {
            selectContract(useBtn.dataset.dirUse, false);
            closeModal("contractsListModal");
          } else if (editBtn) {
            const c = contracts.find((x) => x.id === editBtn.dataset.dirEdit);
            if (c) {
              closeModal("contractsListModal");
              openContractModal(c);
            }
          }
        });

        // History Modal
        document.getElementById("btnOpenHistory").addEventListener("click", () => {
          renderHistoryList();
          openModal("historyModal");
        });
        document.getElementById("historySearchInput").addEventListener("input", renderHistoryList);
        document.getElementById("historyListBody").addEventListener("click", (e) => {
          const loadBtn = e.target.closest("[data-hist-load]");
          const nextBtn = e.target.closest("[data-hist-next]");
          const delBtn = e.target.closest("[data-hist-del]");
          if (loadBtn) {
            const h = history.find((x) => x.id === loadBtn.dataset.histLoad);
            if (h && h.stateSnapshot) {
              invoiceState = clone(h.stateSnapshot);
              syncFormFromState();
              renderAll();
              closeModal("historyModal");
              switchMainView("invoice");
              showToast(`Loaded invoice ${h.sNo}`);
            }
          } else if (nextBtn) {
            const h = history.find((x) => x.id === nextBtn.dataset.histNext);
            if (h && h.stateSnapshot) {
              invoiceState = clone(h.stateSnapshot);
              const nextP = computeNextCyclePeriod(invoiceState.billFromIso, invoiceState.billToIso);
              invoiceState.billFromIso = nextP.startIso;
              invoiceState.billToIso = nextP.endIso;
              invoiceState.invoiceDateIso = todayIso();
              invoiceState.sNo = formatNextSerial((company.lastSerialNumber ?? 0) + 1);
              syncFormFromState();
              renderAll();
              closeModal("historyModal");
              switchMainView("invoice");
              showToast(`Prepared next month bill (${invoiceState.sNo})!`);
            }
          } else if (delBtn) {
            requestConfirmation("Delete this saved invoice from history?", () => {
              history = history.filter((x) => x.id !== delBtn.dataset.histDel);
              saveToStorage(STORAGE_KEYS.HISTORY, history);
              updateHistoryBadge();
              renderHistoryList();
            });
          }
        });

        // Confirm dialog buttons
        document.getElementById("confirmDialogOkBtn").addEventListener("click", () => {
          closeModal("confirmDialogModal");
          if (typeof pendingConfirmCallback === "function") {
            const cb = pendingConfirmCallback;
            pendingConfirmCallback = null;
            cb();
          }
        });
        document.getElementById("confirmDialogCancelBtn").addEventListener("click", () => {
          pendingConfirmCallback = null;
          closeModal("confirmDialogModal");
        });
        document.getElementById("confirmDialogCloseBtn").addEventListener("click", () => {
          pendingConfirmCallback = null;
          closeModal("confirmDialogModal");
        });

        // Backup & Restore Modals
        document.getElementById("btnSaveCompany").addEventListener("click", saveCompanyFromModal);
        document.getElementById("btnBackupRestore").addEventListener("click", () => openModal("backupModal"));

        document.getElementById("btnExportBackup").addEventListener("click", () => {
          const payload = {
            exportedAt: new Date().toISOString(),
            company,
            contracts,
            history,
            employees,
            attendanceStore,
            salaryHistory
          };
          const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `SS_Construction_Full_Backup_${todayIso()}.json`;
          a.click();
          URL.revokeObjectURL(url);
          showToast("Backup JSON downloaded!");
        });

        document.getElementById("inputImportBackup").addEventListener("change", (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const data = JSON.parse(reader.result);
              if (data.company) {
                company = data.company;
                saveToStorage(STORAGE_KEYS.COMPANY, company);
              }
              if (Array.isArray(data.contracts) && data.contracts.length) {
                contracts = data.contracts;
                saveToStorage(STORAGE_KEYS.CONTRACTS, contracts);
              }
              if (Array.isArray(data.history)) {
                history = data.history;
                saveToStorage(STORAGE_KEYS.HISTORY, history);
              }
              if (Array.isArray(data.employees)) {
                employees = data.employees;
                saveToStorage(STORAGE_KEYS.EMPLOYEES, employees);
              }
              if (data.attendanceStore) {
                attendanceStore = data.attendanceStore;
                saveToStorage(STORAGE_KEYS.ATTENDANCE, attendanceStore);
              }
              if (Array.isArray(data.salaryHistory)) {
                salaryHistory = data.salaryHistory;
                saveToStorage(STORAGE_KEYS.SALARY_HISTORY, salaryHistory);
              }
              populateContractSelect();
              updateHistoryBadge();
              updateEmployeeBadgesAndFilters();
              if (contracts.length) selectContract(contracts[0].id); else { syncFormFromState(); renderAll(); }
              closeModal("backupModal");
              showToast("Full Backup restored!");
            } catch (err) {
              showToast("Invalid backup JSON file.");
            }
          };
          reader.readAsText(file);
          e.target.value = "";
        });

        document.getElementById("btnFactoryReset").addEventListener("click", () => {
          requestConfirmation("Reset contracts, employees, and firm profile back to original defaults?", () => {
            company = clone(window.SS_DEFAULT_COMPANY);
            contracts = clone(window.SS_DEFAULT_CONTRACTS);
            employees = clone(window.SS_DEFAULT_EMPLOYEES);
            saveToStorage(STORAGE_KEYS.COMPANY, company);
            saveToStorage(STORAGE_KEYS.CONTRACTS, contracts);
            saveToStorage(STORAGE_KEYS.EMPLOYEES, employees);
            populateContractSelect();
            updateEmployeeBadgesAndFilters();
            selectContract(contracts[0]?.id);
            closeModal("backupModal");
            showToast("Original defaults restored!");
          });
        });

        document.querySelectorAll("[data-close]").forEach((btn) => {
          btn.addEventListener("click", () => closeModal(btn.dataset.close));
        });
        document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
          backdrop.addEventListener("click", (e) => {
            if (e.target === backdrop) closeModal(backdrop.id);
          });
        });
      }

      function init() {
        populateContractSelect();
        updateHistoryBadge();
        updateEmployeeBadgesAndFilters();
        syncSettingsTabFromCompany();
        bindEvents();
        document.getElementById("payMonthInput").value = payrollState.monthYm;
        if (contracts.length) {
          selectContract(contracts[0].id, true);
        } else {
          syncFormFromState(); renderAll();
        }
        switchMainView(Object.keys(routes).find(k => routes[k] === location.hash) || "dashboard", false);
      }

      init();
    })();
  