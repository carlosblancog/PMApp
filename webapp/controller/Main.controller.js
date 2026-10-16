sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (Controller, JSONModel, MessageBox, MessageToast) {
    "use strict";

    return Controller.extend("com.alk.pmregistration.controller.Main", {

        onInit: function () {
            var oLocalModel = new JSONModel({
                busy: true,
                period: "",
                accessGranted: false,
                accessDenied: false,
                selectedCount: 0,
                projects: [],
                filterCounts: { all: "0", unreleased: "0", released: "0", approved: "0", pending: "0" }
            });
            this.getView().setModel(oLocalModel, "localModel");
            this._sSearchTerm = "";
            this._sFilterKey = "all";
            this._aAllProjects = [];
            this._oModel = this.getOwnerComponent().getModel();
            this._checkPMAccess();
        },

        // ── Access ────────────────────────────────────────────────────────────

        _checkPMAccess: function () {
            this._oModel.callFunction("/CheckPM", {
                method: "GET",
                success: function (oData) {
                    var bAccess = oData.HasAccess === true ||
                                  !!(oData.CheckPM && oData.CheckPM.HasAccess);
                    if (bAccess) {
                        this._loadParams();
                    } else {
                        var oLM = this.getView().getModel("localModel");
                        oLM.setProperty("/accessDenied", true);
                        oLM.setProperty("/busy", false);
                    }
                }.bind(this),
                error: function () {
                    var oLM = this.getView().getModel("localModel");
                    oLM.setProperty("/accessDenied", true);
                    oLM.setProperty("/busy", false);
                }.bind(this)
            });
        },

        // ── Data loading ──────────────────────────────────────────────────────

        _loadParams: function () {
            this._oModel.callFunction("/GetPMParams", {
                method: "GET",
                success: function (oData) {
                    this.getView().getModel("localModel").setProperty("/period", oData.Period || "");
                    this._loadSummary();
                }.bind(this),
                error: function () {
                    this._loadSummary();
                }.bind(this)
            });
        },

        _loadSummary: function () {
            var oLM = this.getView().getModel("localModel");
            oLM.setProperty("/busy", true);
            this._oModel.callFunction("/GetPMSummary", {
                method: "GET",
                urlParameters: {
                    SearchTerm: this._sSearchTerm,
                    Offset: 0,
                    Limit: 500
                },
                success: function (oData) {
                    var aItems = (oData && oData.results) ? oData.results : [];
                    this._aAllProjects = this._buildProjects(aItems);
                    this._applyFilter();
                    oLM.setProperty("/accessGranted", true);
                    oLM.setProperty("/busy", false);
                }.bind(this),
                error: function () {
                    oLM.setProperty("/busy", false);
                }.bind(this)
            });
        },

        // ── Data transformation ───────────────────────────────────────────────

        _buildProjects: function (aItems) {
            var mProjects = {};
            var aOrder = [];

            aItems.forEach(function (oItem) {
                var sKey = oItem.ProjectId;
                if (!mProjects[sKey]) {
                    mProjects[sKey] = {
                        projectId:       sKey,
                        projectName:     oItem.ProjectName || sKey,
                        projectDesc:     oItem.Description || "",
                        totalHours:      0,
                        notReleasedCount: 0,
                        isFullyApproved: true,
                        isSelected:      false,
                        _empReleased:    {},
                        rows:            []
                    };
                    aOrder.push(sKey);
                }
                var oPrj = mProjects[sKey];
                var fHours   = parseFloat(oItem.TotalHours) || 0;
                var bReleased = oItem.IsReleased === true;
                var bApproved = oItem.IsApproved === true;

                oPrj.totalHours += fHours;
                if (!bApproved) { oPrj.isFullyApproved = false; }

                if (oPrj._empReleased[oItem.EmployeeId] === undefined) {
                    oPrj._empReleased[oItem.EmployeeId] = bReleased;
                } else if (!bReleased) {
                    oPrj._empReleased[oItem.EmployeeId] = false;
                }

                oPrj.rows.push({
                    isTotal:      false,
                    employeeId:   oItem.EmployeeId,
                    employeeName: oItem.EmployeeName || oItem.EmployeeId,
                    displayName:  oItem.DisplayName  || oItem.SubtaskId || "",
                    opexCapex:    oItem.OpexCapex    || "",
                    totalHours:   fHours,
                    isReleased:   bReleased,
                    isApproved:   bApproved
                });
            });

            return aOrder.map(function (sKey) {
                var oPrj = mProjects[sKey];
                var iNotReleased = Object.keys(oPrj._empReleased).filter(function (k) {
                    return !oPrj._empReleased[k];
                }).length;
                oPrj.notReleasedCount = iNotReleased;
                oPrj.totalHours = Math.round(oPrj.totalHours * 100) / 100;
                delete oPrj._empReleased;

                var mEmp = {}, aEmpOrder = [];
                oPrj.rows.forEach(function (r) {
                    if (!mEmp[r.employeeId]) {
                        mEmp[r.employeeId] = { name: r.employeeName, rows: [] };
                        aEmpOrder.push(r.employeeId);
                    }
                    mEmp[r.employeeId].rows.push(r);
                });
                var aFlat = [];
                aEmpOrder.forEach(function (sId) {
                    var oEmp = mEmp[sId];
                    oEmp.rows.forEach(function (r) { aFlat.push(r); });
                    aFlat.push({
                        isTotal:      true,
                        employeeId:   sId,
                        employeeName: oEmp.name,
                        displayName:  "",
                        opexCapex:    "",
                        totalHours:   Math.round(oEmp.rows.reduce(function (s, r) { return s + r.totalHours; }, 0) * 100) / 100,
                        isReleased:   false,
                        isApproved:   false
                    });
                });
                oPrj.rows = aFlat;

                return oPrj;
            });
        },

        // ── Filtering ─────────────────────────────────────────────────────────

        _applyFilter: function () {
            var oLM = this.getView().getModel("localModel");
            var aAll = this._aAllProjects;

            aAll.forEach(function (p) { p.isSelected = false; });

            var aFiltered;
            switch (this._sFilterKey) {
                case "unreleased": aFiltered = aAll.filter(function (p) { return p.notReleasedCount > 0; }); break;
                case "released":   aFiltered = aAll.filter(function (p) { return p.notReleasedCount === 0; }); break;
                case "approved":   aFiltered = aAll.filter(function (p) { return p.isFullyApproved; }); break;
                case "pending":    aFiltered = aAll.filter(function (p) { return !p.isFullyApproved; }); break;
                default:           aFiltered = aAll.slice(); break;
            }

            oLM.setProperty("/projects", aFiltered);
            oLM.setProperty("/selectedCount", 0);
            oLM.setProperty("/filterCounts", {
                all:        String(aAll.length),
                unreleased: String(aAll.filter(function (p) { return p.notReleasedCount > 0; }).length),
                released:   String(aAll.filter(function (p) { return p.notReleasedCount === 0; }).length),
                approved:   String(aAll.filter(function (p) { return p.isFullyApproved; }).length),
                pending:    String(aAll.filter(function (p) { return !p.isFullyApproved; }).length)
            });
        },

        onFilterSelect: function (oEvent) {
            this._sFilterKey = oEvent.getParameter("key");
            this._applyFilter();
        },

        // ── Events ────────────────────────────────────────────────────────────

        onSearch: function (oEvent) {
            this._sSearchTerm = oEvent.getParameter("query") || oEvent.getParameter("newValue") || "";
            this._loadSummary();
        },

        onRefresh: function () {
            this._sSearchTerm = "";
            this._loadSummary();
        },

        onProjectSelect: function () {
            var aProjects = this.getView().getModel("localModel").getProperty("/projects");
            var iCount = aProjects.filter(function (p) { return p.isSelected; }).length;
            this.getView().getModel("localModel").setProperty("/selectedCount", iCount);
        },

        // ── Approve ───────────────────────────────────────────────────────────

        onApprove: function () {
            var oLM      = this.getView().getModel("localModel");
            var aProjects = oLM.getProperty("/projects");
            var aSelected = aProjects.filter(function (p) { return p.isSelected; });
            if (!aSelected.length) { return; }

            var sPeriod  = oLM.getProperty("/period");
            var sNames   = aSelected.map(function (p) { return "• " + p.projectName; }).join("\n");
            var sMsg     = "Approve " + aSelected.length + " project(s) for period " + sPeriod + "?\n\n" + sNames;

            MessageBox.confirm(sMsg, {
                title: "Confirm approval",
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        var sIds = aSelected.map(function (p) { return p.projectId; }).join(";");
                        this._doApprove(sIds);
                    }
                }.bind(this)
            });
        },

        _doApprove: function (sProjectIds) {
            var oLM = this.getView().getModel("localModel");
            oLM.setProperty("/busy", true);
            this._oModel.callFunction("/ApproveEntries", {
                method: "POST",
                urlParameters: { ProjectIds: sProjectIds },
                success: function () {
                    MessageToast.show("Approval completed successfully.");
                    this._loadSummary();
                }.bind(this),
                error: function () {
                    oLM.setProperty("/busy", false);
                    MessageBox.error("Error approving. Please try again.");
                }.bind(this)
            });
        }
    });
});
