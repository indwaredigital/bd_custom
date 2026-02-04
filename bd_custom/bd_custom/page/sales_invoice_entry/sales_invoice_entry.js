frappe.pages["sales-invoice-entry"].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		single_column: true,
	});

	const container = $('<div id="sales-invoice-react-root"></div>').appendTo(page.main);
	new SalesInvoiceApp(container[0], page);
};

class SalesInvoiceApp {
	constructor(container, page) {
		this.container = container;
		this.page = page;
		this.state = {
			invoiceNo: "",
			postingDate: frappe.datetime.get_today(),
			customer: null,
			shipping_address: null,
			shipping_addresses: [],
			items: [
				{
					id: 1,
					item_code: null,
					item_name: "",
					batch_no: null,
					qty: "",
					rate: "",
					uom: "",
					amount: 0,
					tax_amount: 0,
					total_amount: 0,
				},
			],
			remarks: "",
			saving: false,
			activeModal: null,
			searchTerm: "",
			selectedModalIndex: 0,
			taxes: [],
			taxes_and_charges: "",
			net_total: 0,
			total_taxes_and_charges: 0,
			grand_total: 0,
			rounded_total: 0,
			rounding_adjustment: 0,
			company: frappe.defaults.get_default("company"),
			sales_account: null,
		};

		this.income_accounts = [];

		this.customers = [];
		this.items_list = [];
		this.batches = [];
		this.activeLineIndex = 0;

		this.loadData();
		this.render();
		this.attachEventListeners();
		this.attachGlobalShortcuts();

		// Initial focus
		// setTimeout(() => $(this.container).find('#invoice_no').focus(), 500);
	}

	loadData() {
		// Load customers
		frappe.call({
			method: "bd_custom.bd_custom.page.sales_invoice_entry.sales_invoice_entry.get_active_customers",
			callback: (r) => {
				if (r.message) {
					this.customers = r.message;
				}
			},
		});

		// Load items with prices
		frappe.call({
			method: "bd_custom.bd_custom.page.sales_invoice_entry.sales_invoice_entry.get_items_list",
			callback: (r) => {
				if (r.message) {
					this.items_list = r.message;
				}
			},
		});

		// Load Next ID
		frappe.call({
			method: "bd_custom.bd_custom.page.sales_invoice_entry.sales_invoice_entry.get_next_id",
			callback: (r) => {
				if (r.message) {
					this.setState({ invoiceNo: r.message });
				}
			},
		});

		// Load Income Accounts
		frappe.call({
			method: "bd_custom.bd_custom.page.sales_invoice_entry.sales_invoice_entry.get_income_accounts",
			callback: (r) => {
				if (r.message) {
					this.income_accounts = r.message;
					// Force selection if not set
					if (!this.state.sales_account) {
						this.setState({
							activeModal: "sales_account",
							searchTerm: "",
							selectedModalIndex: 0,
						});
					}
				}
			},
		});
	}

	loadShippingAddresses(customerName) {
		frappe.call({
			method: "bd_custom.bd_custom.page.sales_invoice_entry.sales_invoice_entry.get_shipping_addresses",
			args: {
				customer: customerName,
			},
			callback: (res) => {
				if (res.message) {
					const addresses = res.message;
					this.state.shipping_addresses = addresses;

					// Force user to choose address always, do not auto-select
					this.render();
					this.attachEventListeners();
					setTimeout(() => $(this.container).find("#address_field").focus(), 100);
				}
			},
		});
	}
	setState(newState) {
		this.state = { ...this.state, ...newState };
		this.render();
		this.attachEventListeners();
	}

	// Only update totals without full re-render
	updateTotalsOnly() {
		const container = $(this.container);
		const subtotal = this.calculateSubtotal();
		container.find("#subtotal").text(
			subtotal.toLocaleString("en-IN", {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			})
		);

		const roundingRow = container.find("#rounding_row");
		const roundingAdjustment = this.state.rounding_adjustment || 0;
		if (roundingAdjustment) {
			roundingRow.show();
			container.find("#rounding_adjustment").text(
				roundingAdjustment.toLocaleString("en-IN", {
					minimumFractionDigits: 2,
					maximumFractionDigits: 2,
				})
			);
		} else {
			roundingRow.hide();
		}

		const grandTotal = this.state.rounded_total || this.state.grand_total || subtotal;
		container.find("#grand_total").text(
			grandTotal.toLocaleString("en-IN", {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			})
		);

		// Show template name if available
		const templateDisplay = container.find("#tax_template_display");
		if (this.state.taxes_and_charges) {
			templateDisplay.text(this.state.taxes_and_charges).show();
		} else {
			templateDisplay.hide();
		}

		// Dynamically render tax rows
		const taxRowsContainer = container.find("#tax_rows");
		if (taxRowsContainer.length) {
			const taxHTML = this.state.taxes
				.map(
					(tax) => `
				<div class="total-row">
					<span>${tax.description}</span>
					<span>₹${(tax.tax_amount || 0).toLocaleString("en-IN", {
						minimumFractionDigits: 2,
						maximumFractionDigits: 2,
					})}</span>
				</div>
			`
				)
				.join("");
			taxRowsContainer.html(taxHTML);
		}
	}

	refreshLineAmounts() {
		this.state.items.forEach((item, index) => {
			this.updateLineAmount(index);
		});
	}

	// Update single line amount and rate without full re-render
	updateLineAmount(index) {
		const item = this.state.items[index];
		const container = $(this.container);

		// Update amount display
		container.find(`.amount-display[data-index="${index}"]`).val(item.total_amount.toFixed(2));
		container
			.find(`.amount-display[data-index="${index}"]`)
			.attr(
				"title",
				`Base: ₹${item.amount.toFixed(2)} + Tax: ₹${(
					item.total_amount - item.amount
				).toFixed(2)}`
			);

		// Sync rate back to input if it changed (e.g. from server)
		const rateInput = container.find(`.rate-input[data-index="${index}"]`);
		if (parseFloat(rateInput.val()) !== parseFloat(item.rate)) {
			rateInput.val(item.rate);
		}

		this.updateTotalsOnly();
	}

	render() {
		const {
			invoiceNo,
			postingDate,
			customer,
			shipping_address,
			shipping_addresses,
			items,
			remarks,
			saving,
			activeModal,
			searchTerm,
			selectedModalIndex,
		} = this.state;

		this.container.innerHTML = `
			<div class="invoice-entry-container" id="invoice_entry_form">
				<div class="invoice-form">
					<!-- Header -->
					<div class="form-header">
						<h2>Sales Invoice</h2>
						<div class="shortcuts-info">
							<span><kbd>F2</kbd> Today</span>
							<span><kbd>Tab</kbd> Next</span>
							<span><kbd>Shift+Tab</kbd> Previous</span>
							<span><kbd>Enter</kbd> Select/New Row</span>
							<span><kbd>Ctrl+S</kbd> Save</span>
							<span><kbd>Esc</kbd> Cancel</span>
						</div>
					</div>

					<!-- Form Body -->
					<div class="form-body">
						<div class="row mb-3">
							<div class="col-md-12 form-group">
								<label>Sales Account</label>
								<div id="sales_account_field" class="form-control custom-field" style="width: 100%; background-color: #f9fafb; cursor: pointer;" tabindex="0">
									${
										this.state.sales_account
											? `
										<span style="font-weight: 600;">${this.state.sales_account}</span>
									`
											: '<span style="color: #9ca3af;">Select Sales Account...</span>'
									}
								</div>
							</div>
						</div>

						<div class="row mb-3">
							<div class="col-md-6 form-group">
								<label>Invoice No.</label>
								<input type="text" id="invoice_no" class="form-control" style="width: 100%;" value="${invoiceNo}" placeholder="Auto-Generated..." readonly>
							</div>
							<div class="col-md-6 form-group">
								<label>Posting Date</label>
								<input type="date" id="posting_date" class="form-control" style="width: 100%;" value="${postingDate}">
							</div>
						</div>

						<div class="row mb-3">
							<div class="col-md-12 form-group">
								<label>Customer</label>
								<div id="customer_field" class="form-control custom-field" style="width: 100%;" tabindex="0">
									${
										customer
											? `
										<div style="display: flex; flex-direction: column; position: relative; padding-right: 25px;">
											<span class="modal-item-title">${customer.customer_name}</span>
											<span class="modal-item-subtitle">${customer.name}</span>
											<i class="fa fa-info-circle" id="customer_info_btn" style="position: absolute; right: 0; top: 0; padding: 5px; color: var(--text-light); cursor: pointer; font-size: 16px;"></i>
										</div>
									`
											: '<span style="color: #9ca3af;">Select Customer...</span>'
									}
								</div>
							</div>
						</div>

						${
							customer
								? `
							<div class="row mb-3 shipping-address-container">
								<div class="col-md-12 form-group">
									<label>Shipping Address</label>
									<div id="address_field" class="form-control custom-field" style="width: 100%;" tabindex="0">
										${
											shipping_address
												? `
											<div style="display: flex; flex-direction: column;">
												<div style="display: flex; align-items: center; gap: 8px;">
													<span class="modal-item-title">${shipping_address}</span>
													<i class="fa fa-info-circle" id="address_info_btn" style="color: var(--text-light); cursor: pointer; font-size: 16px;"></i>
												</div>
												<span class="modal-item-subtitle">
													${[
														shipping_addresses.find(
															(a) => a.name === shipping_address
														)?.address_line1,
														shipping_addresses.find(
															(a) => a.name === shipping_address
														)?.address_line2,
														shipping_addresses.find(
															(a) => a.name === shipping_address
														)?.city,
														shipping_addresses.find(
															(a) => a.name === shipping_address
														)?.state,
														shipping_addresses.find(
															(a) => a.name === shipping_address
														)?.pincode,
														shipping_addresses.find(
															(a) => a.name === shipping_address
														)?.country,
													]
														.filter(Boolean)
														.join(", ")}
												</span>
											</div>
										`
												: '<span style="color: #9ca3af;">Select Shipping Address...</span>'
										}
									</div>
								</div>
							</div>
						`
								: ""
						}
						<!-- Items Table -->
						<div class="items-table-container">
							<div class="table-head">
								<div>Item</div>
								<div>BATCH NO.</div>
								<div>Qty</div>
								<div>Rate</div>
								<div>Amount (Inc. Tax)</div>
							</div>
							<div id="item-rows">
								${items
									.map(
										(item, index) => `
									<div class="item-row" data-index="${index}">
										<div class="item-field custom-field" data-index="${index}" tabindex="0">
											<span style="color: ${item.item_name ? "inherit" : "#9ca3af"};">${
											item.item_name || "Select Item..."
										}</span>
										</div>
										<div class="batch-field custom-field" data-index="${index}" tabindex="0" style="background: ${
											item.item_code ? "inherit" : "#f9fafb"
										};">
											<span style="color: ${item.batch_no ? "inherit" : "#9ca3af"};">${
											item.batch_no || "Batch..."
										}</span>
										</div>
										<input type="number" class="qty-input" data-index="${index}" value="${item.qty}" placeholder="0" ${
											!item.item_code ? "disabled" : ""
										}>
										<input type="number" class="rate-input" data-index="${index}" value="${
											item.rate
										}" placeholder="0.00" ${!item.item_code ? "disabled" : ""}>
										<input type="number" class="amount-display" data-index="${index}" value="${item.total_amount.toFixed(
											2
										)}" readonly tabindex="-1">
									</div>
								`
									)
									.join("")}
							</div>
						</div>

						<!-- Totals -->
						<div class="totals-section">
							<div class="totals-table">
								<div id="tax_template_display" style="font-size: 11px; color: var(--text-secondary); margin-bottom: 10px; font-weight: 600; display: none;"></div>
								<div class="total-row">
									<span>Subtotal</span>
									<span>₹<span id="subtotal">${this.calculateSubtotal().toFixed(2)}</span></span>
								</div>
								<div id="tax_rows">
									${this.state.taxes
										.map(
											(tax) => `
										<div class="total-row">
											<span>${tax.description}</span>
											<span>₹${(tax.tax_amount || 0).toFixed(2)}</span>
										</div>
									`
										)
										.join("")}
								</div>
								<div class="total-row" id="rounding_row" style="display: ${
									this.state.rounding_adjustment ? "flex" : "none"
								};">
									<span>Rounding Adjustment</span>
									<span>₹<span id="rounding_adjustment">${(this.state.rounding_adjustment || 0).toFixed(
										2
									)}</span></span>
								</div>
								<div class="total-row grand-total">
									<span>Grand Total</span>
									<span>₹<span id="grand_total">${(
										this.state.rounded_total ||
										this.state.grand_total ||
										this.calculateSubtotal()
									).toFixed(2)}</span></span>
								</div>
							</div>
						</div>

						<!-- Remarks -->
						<div class="form-group mt-4">
							<label>Remarks</label>
							<textarea id="remarks" class="form-control" style="width: 100%; height: 80px;" placeholder="Notes...">${remarks}</textarea>
						</div>

						<!-- Actions -->
						<div class="mt-4" style="display: flex; gap: 10px; justify-content: flex-end;">
							<button class="btn btn-secondary btn-cancel">Cancel</button>
							<button class="btn btn-primary btn-save" ${saving ? "disabled" : ""}>
								${saving ? "Saving..." : "Save"}
							</button>
						</div>
					</div>
				</div>

				${activeModal ? this.renderModal() : ""}
			</div>
		`;
	}

	renderModal() {
		const { activeModal, searchTerm, saving } = this.state;
		let title = "";

		if (activeModal === "customer") title = "Select Customer";
		else if (activeModal === "item") title = "Select Item";
		else if (activeModal === "batch") title = "Select Batch";
		else if (activeModal === "address") title = "Select Shipping Address";
		else if (activeModal === "sales_account") title = "Select Sales Account";
		else if (activeModal === "save_options")
			return `
			<div class="custom-modal-overlay">
				<div class="custom-modal-content" style="max-width: 400px; padding-top: 10px;">
					<div class="modal-header">
						<h3 style="margin: 0; font-size: 16px;">Save Invoice</h3>
						<button class="modal-close btn-secondary" style="padding: 2px 8px; border: none;">&times;</button>
					</div>
					<div class="modal-body" style="padding: 30px; text-align: center; display: flex; flex-direction: column; gap: 15px;">
						<button class="btn btn-primary btn-save-new" style="padding: 12px;" ${saving ? "disabled" : ""}>
							<i class="fa fa-plus"></i> ${saving ? "Saving..." : "Save & Create New"}
						</button>
						<button class="btn btn-secondary btn-save-close" style="padding: 12px;" ${
							saving ? "disabled" : ""
						}>
							<i class="fa fa-check"></i> ${saving ? "Saving..." : "Save & Close"}
						</button>
					</div>
				</div>
			</div>
		`;
		else if (activeModal === "customer_details")
			return `
			<div class="custom-modal-overlay">
				<div class="custom-modal-content" style="max-width: 500px; padding-top: 10px;">
					<div class="modal-header">
						<h3 style="margin: 0; font-size: 16px;">Customer Details</h3>
						<button class="modal-close btn-secondary" style="padding: 2px 8px; border: none;">&times;</button>
					</div>
					<div class="modal-body" style="padding: 20px;">

						<!-- General Info -->
						<table class="table table-bordered" style="margin: 0; font-size: 13px; margin-bottom: 15px;">
							<tbody>
								<tr>
									<td style="width: 40%; font-weight: 600; color: var(--text-regular);">Name</td>
									<td>${this.state.customer.customer_name}</td>
								</tr>
								<tr>
									<td style="font-weight: 600; color: var(--text-regular);">ID</td>
									<td>${this.state.customer.name}</td>
								</tr>
								<tr>
									<td style="font-weight: 600; color: var(--text-regular);">Group</td>
									<td>${this.state.customer.customer_group || "-"}</td>
								</tr>
							</tbody>
						</table>

						<!-- Tax Details Section -->
						<h4 style="margin: 0 0 10px; font-size: 14px; font-weight: 600;">Tax Details</h4>
						<table class="table table-bordered" style="margin: 0; font-size: 13px; margin-bottom: 15px;">
							<tbody>
								<tr>
									<td style="width: 40%; font-weight: 600; color: var(--text-regular);">GSTIN / UIN</td>
									<td>${this.state.customer.gstin || this.state.customer.tax_id || "-"}</td>
								</tr>
								<tr>
									<td style="font-weight: 600; color: var(--text-regular);">PAN</td>
									<td>${this.state.customer.pan || "-"}</td>
								</tr>
							</tbody>
						</table>

						<!-- Other Details -->
						${
							this.state.customer.custom_drug_lic_no ||
							this.state.customer.custom_msme
								? `
							<h4 style="margin: 0 0 10px; font-size: 14px; font-weight: 600;">Other Details</h4>
							<table class="table table-bordered" style="margin: 0; font-size: 13px; margin-bottom: 15px;">
								<tbody>
									<tr>
										<td style="width: 40%; font-weight: 600; color: var(--text-regular);">Drug Lic. No.</td>
										<td>${this.state.customer.custom_drug_lic_no || "-"}</td>
									</tr>
									<tr>
										<td style="font-weight: 600; color: var(--text-regular);">MSME</td>
										<td>${this.state.customer.custom_msme || "-"}</td>
									</tr>
								</tbody>
							</table>
						`
								: ""
						}

						<!-- Addresses -->
						<h4 style="margin: 0 0 10px; font-size: 14px; font-weight: 600;">Addresses</h4>
						<div style="max-height: 200px; overflow-y: auto;">
							<table class="table table-bordered" style="margin: 0; font-size: 12px;">
								<thead style="background: #f9fafb;">
									<tr>
										<th>ID</th>
										<th>Address</th>
										<th>GSTIN / UIN</th>
										<th style="width: 40px; text-align: center;">View</th>
									</tr>
								</thead>
								<tbody>
									${
										(this.state.shipping_addresses || []).length > 0
											? this.state.shipping_addresses
													.map(
														(addr) => `
											<tr>
												<td>${addr.name}</td>
												<td>
													${addr.address_line1 || ""}<br>
													${addr.city || ""}, ${addr.state || ""}
												</td>
												<td>${addr.gstin || "-"}</td>
												<td style="text-align: center; vertical-align: middle;">
													<i class="fa fa-eye btn-view-address" data-name="${
														addr.name
													}" style="cursor: pointer; color: var(--primary-color);"></i>
												</td>
											</tr>
										`
													)
													.join("")
											: '<tr><td colspan="4" style="text-align: center; color: #999;">No addresses found</td></tr>'
									}
								</tbody>
							</table>
						</div>
						<div style="text-align: right; margin-top: 15px; border-top: 1px solid var(--border-color); padding-top: 15px;">
							${
								this.state.returnToModal === "customer"
									? `<button class="btn btn-secondary btn-back-customer-list" style="font-size: 12px;">Back to List</button>`
									: ""
							}
						</div>
					</div>
				</div>
			</div>
		`;
		else if (activeModal === "address_details") {
			const addr =
				this.state.shipping_addresses.find((a) => a.name === this.state.viewAddressId) ||
				{};
			return `
			<div class="custom-modal-overlay">
				<div class="custom-modal-content" style="max-width: 500px; padding-top: 10px;">
					<div class="modal-header">
						<h3 style="margin: 0; font-size: 16px;">Address Details - ${addr.name}</h3>
						<button class="modal-close btn-secondary" style="padding: 2px 8px; border: none;">&times;</button>
					</div>
					<div class="modal-body" style="padding: 20px;">
						<table class="table table-bordered" style="margin: 0; font-size: 13px;">
							<tbody>
								<tr>
									<td style="width: 35%; font-weight: 600; color: var(--text-regular);">Address Title</td>
									<td>${addr.address_title || addr.name}</td>
								</tr>
								<tr>
									<td style="font-weight: 600; color: var(--text-regular);">Address Line 1</td>
									<td>${addr.address_line1 || "-"}</td>
								</tr>
								<tr>
									<td style="font-weight: 600; color: var(--text-regular);">Address Line 2</td>
									<td>${addr.address_line2 || "-"}</td>
								</tr>
								<tr>
									<td style="font-weight: 600; color: var(--text-regular);">City / State</td>
									<td>${addr.city || ""} ${addr.state ? ", " + addr.state : ""}</td>
								</tr>
								<tr>
									<td style="font-weight: 600; color: var(--text-regular);">Pincode</td>
									<td>${addr.pincode || "-"}</td>
								</tr>
								<tr>
									<td style="font-weight: 600; color: var(--text-regular);">Country</td>
									<td>${addr.country || "-"}</td>
								</tr>
								<tr>
									<td style="font-weight: 600; color: var(--text-regular);">GSTIN / UIN</td>
									<td>${addr.gstin || "-"}</td>
								</tr>
								<tr>
									<td style="font-weight: 600; color: var(--text-regular);">GST State</td>
									<td>${addr.gst_state || "-"}</td>
								</tr>
								<tr>
									<td style="font-weight: 600; color: var(--text-regular);">GST State Number</td>
									<td>${addr.gst_state_number || "-"}</td>
								</tr>
								<tr>
									<td style="font-weight: 600; color: var(--text-regular);">Email</td>
									<td>${addr.email_id || "-"}</td>
								</tr>
								<tr>
									<td style="font-weight: 600; color: var(--text-regular);">Phone</td>
									<td>${addr.phone || "-"}</td>
								</tr>
							</tbody>
						</table>
						<div style="text-align: right; margin-top: 15px;">
							${
								this.state.returnToModal === "customer_details"
									? `<button class="btn btn-secondary btn-back-customer" style="font-size: 12px;">Back to Customer</button>`
									: this.state.returnToModal === "address"
									? `<button class="btn btn-secondary btn-back-address-list" style="font-size: 12px;">Back to List</button>`
									: ""
							}
						</div>
					</div>
				</div>
			</div>
			`;
		}
		return `
			<div class="custom-modal-overlay">
				<div class="custom-modal-content">
					<div class="modal-header">
						<h3 style="margin: 0; font-size: 16px;">${title}</h3>
						<button class="modal-close btn-secondary" style="padding: 2px 8px; border: none; ${
							activeModal === "sales_account" ? "display:none;" : ""
						}">&times;</button>
					</div>
					<div style="padding: 15px; border-bottom: 1px solid var(--border-color);">
						<input type="text" id="modal_search" class="form-control" style="width: 100%;" value="${searchTerm}" placeholder="Search..." autofocus>
					</div>
					<div class="modal-body" id="modal_results">
						${this.getModalResultsHTML()}
					</div>
				</div>
			</div>
			`;
	}

	getModalResultsHTML() {
		const { activeModal, searchTerm, selectedModalIndex } = this.state;
		let list = [];

		if (activeModal === "customer") {
			list = this.customers.filter(
				(c) =>
					c.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
					c.name.toLowerCase().includes(searchTerm.toLowerCase())
			);
		} else if (activeModal === "item") {
			list = this.items_list.filter(
				(i) =>
					i.item_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
					i.name.toLowerCase().includes(searchTerm.toLowerCase())
			);
		} else if (activeModal === "batch") {
			list = this.batches.filter((b) =>
				b.name.toLowerCase().includes(searchTerm.toLowerCase())
			);
		} else if (activeModal === "address") {
			list = this.state.shipping_addresses.filter(
				(a) =>
					a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
					a.address_line1.toLowerCase().includes(searchTerm.toLowerCase())
			);
		} else if (activeModal === "sales_account") {
			list = this.income_accounts.filter(
				(a) =>
					a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
					a.account_name.toLowerCase().includes(searchTerm.toLowerCase())
			);
		}

		if (list.length === 0)
			return '<div style="padding: 20px; text-align: center; color: var(--light-text);">No results</div>';

		return list
			.map((item, index) => {
				const isSelected = index === selectedModalIndex;
				if (activeModal === "customer") {
					return `<div class="modal-item ${
						isSelected ? "selected" : ""
					}" data-index="${index}" style="position: relative; padding-right: 30px;">
					<div class="modal-item-title">${item.customer_name}</div>
					<div class="modal-item-subtitle">${item.name}</div>
					<i class="fa fa-info-circle modal-item-info-btn" data-index="${index}" style="position: absolute; right: 10px; top: 12px; color: var(--text-light); cursor: pointer; z-index: 10; font-size: 16px;"></i>
				</div>`;
				} else if (activeModal === "item") {
					return `<div class="modal-item ${
						isSelected ? "selected" : ""
					}" data-index="${index}">
					<div class="modal-item-title">${item.item_name}</div>
					<div class="modal-item-subtitle">${item.name} | ₹${item.standard_rate || 0}</div>
				</div>`;
				} else if (activeModal === "batch") {
					const qty = parseFloat(item.actual_qty) || 0;
					const statusClass = qty <= 5 ? "stock-badge-red" : "stock-badge-green";
					return `<div class="modal-item batch-item ${
						isSelected ? "selected" : ""
					}" data-index="${index}">
					<div class="modal-item-info">
						<div class="modal-item-title">${item.name}</div>
					</div>
					<div class="stock-badge ${statusClass}">
						<i class="fa fa-cubes"></i> ${qty} Nos
					</div>
				</div>`;
				} else if (activeModal === "address") {
					return `<div class="modal-item ${
						isSelected ? "selected" : ""
					}" data-index="${index}" style="position: relative; padding-right: 30px;">
					<div class="modal-item-title">${item.name}</div>
					<div class="modal-item-subtitle">
						${[item.address_line1, item.address_line2, item.city, item.state, item.pincode, item.country]
							.filter(Boolean)
							.join(", ")}
					</div>
					<i class="fa fa-info-circle modal-item-info-btn" data-index="${index}" style="position: absolute; right: 10px; top: 12px; color: var(--text-light); cursor: pointer; z-index: 10; font-size: 16px;"></i>
				</div>`;
				} else if (activeModal === "sales_account") {
					return `<div class="modal-item ${
						isSelected ? "selected" : ""
					}" data-index="${index}">
					<div class="modal-item-title">${item.account_name}</div>
					<div class="modal-item-subtitle">${item.name}</div>
				</div>`;
				}
			})
			.join("");
	}

	renderModalResults() {
		const container = $(this.container).find("#modal_results");
		if (container.length) {
			container.html(this.getModalResultsHTML());
			this.attachModalItemListeners();
		}
	}

	attachEventListeners() {
		const container = $(this.container);

		container.find("#invoice_no").on("input", (e) => (this.state.invoiceNo = e.target.value));
		container
			.find("#posting_date")
			.on("change", (e) => (this.state.postingDate = e.target.value));

		container.find("#customer_field").on("click", (e) => {
			if (e.target.id === "customer_info_btn") {
				e.stopPropagation();
				this.setState({ activeModal: "customer_details" });
			} else {
				this.setState({ activeModal: "customer", searchTerm: "", selectedModalIndex: 0 });
			}
		});

		container.find("#address_field").on("click", (e) => {
			if (e.target.id === "address_info_btn") {
				e.stopPropagation();
				this.setState({
					activeModal: "address_details",
					viewAddressId: this.state.shipping_address,
					returnToModal: null,
				});
			} else {
				this.setState({ activeModal: "address", searchTerm: "", selectedModalIndex: 0 });
			}
		});

		// Attach keydown directly to address field for modal opening
		container.find("#address_field").on("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				e.stopPropagation(); // Stop global handler
				this.setState({ activeModal: "address", searchTerm: "", selectedModalIndex: 0 });
			} else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
				e.preventDefault();
				container.find(".item-field").first().focus();
			} else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
				e.preventDefault();
				container.find("#customer_field").focus();
			}
		});

		container.find("#sales_account_field").on("click", () => {
			// Allow re-selecting sales account
			this.setState({ activeModal: "sales_account", searchTerm: "", selectedModalIndex: 0 });
		});

		// Navigation between Header fields using Arrow Keys
		container.find("#sales_account_field").on("keydown", (e) => {
			if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === "Enter") {
				e.preventDefault();
				container.find("#posting_date").focus();
			}
		});

		container.find("#posting_date").on("keydown", (e) => {
			if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
				e.preventDefault();
				container.find("#sales_account_field").focus();
			} else if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === "Enter") {
				e.preventDefault();
				container.find("#customer_field").focus();
			}
		});

		container.find("#customer_field").on("keydown", (e) => {
			if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
				e.preventDefault();
				// If Sales Account modal is open, let modal handle it, otherwise navigate back
				if (!this.state.activeModal) {
					container.find("#posting_date").focus();
				}
			} else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
				if (!this.state.activeModal) {
					e.preventDefault();
					if (this.state.customer) {
						container.find("#address_field").focus();
					} else {
						container.find(".item-field").first().focus();
					}
				}
			}
		});

		container.find(".item-field").on("click", (e) => {
			this.activeLineIndex = parseInt($(e.currentTarget).data("index"));
			this.setState({ activeModal: "item", searchTerm: "", selectedModalIndex: 0 });
		});

		container.find(".batch-field").on("click", (e) => {
			const index = parseInt($(e.currentTarget).data("index"));
			const item = this.state.items[index];
			if (item.item_code) {
				this.activeLineIndex = index;
				this.loadBatches(item.item_code);
			}
		});

		container.find(".qty-input").on("input", (e) => {
			const index = parseInt($(e.target).data("index"));
			this.state.items[index].qty = e.target.value;
			this.calculateLineAmount(index, false); // Pass false to not auto-add row on every qty input
		});

		container.find(".rate-input").on("input", (e) => {
			const index = parseInt($(e.target).data("index"));
			this.state.items[index].rate = e.target.value;
			this.calculateLineAmount(index, false);
		});

		// Auto-select text on focus for numeric inputs
		container.find(".qty-input, .rate-input, #invoice_no").on("focus", (e) => {
			setTimeout(() => e.target.select(), 50);
		});

		container.find("#remarks").on("input", (e) => (this.state.remarks = e.target.value));

		container.find(".btn-save").on("click", () => {
			if (this.validateInvoice()) {
				this.setState({ activeModal: "save_options" });
			}
		});

		container.find(".btn-save-close").on("click", () => this.executeSave("close"));
		container.find(".btn-save-new").on("click", () => this.executeSave("new"));

		if (this.state.activeModal) {
			container.find(".modal-close").on("click", () => {
				if (
					this.state.activeModal === "address_details" &&
					this.state.returnToModal === "customer_details"
				) {
					// Specifically returning to customer details, restore context
					this.setState({
						activeModal: "customer_details",
						returnToModal: this.state.detailsParentReturn,
					});
				} else if (
					["address_details", "customer_details"].includes(this.state.activeModal) &&
					this.state.returnToModal
				) {
					this.setState({ activeModal: this.state.returnToModal });
				} else {
					this.setState({ activeModal: null });
				}
			});

			// View Address Details
			container.find(".btn-view-address").on("click", (e) => {
				e.stopPropagation();
				const addrName = $(e.currentTarget).data("name");
				// Save parent's return context before navigating deeper
				const currentReturn = this.state.returnToModal;
				this.setState({
					activeModal: "address_details",
					viewAddressId: addrName,
					returnToModal: "customer_details",
					detailsParentReturn: currentReturn,
				});
			});

			// Address/Customer List Item Info Button Click
			container.find(".modal-item-info-btn").on("click", (e) => {
				e.stopPropagation();
				const index = $(e.currentTarget).data("index");
				const { activeModal, searchTerm } = this.state;

				if (activeModal === "address") {
					const filtered = this.state.shipping_addresses.filter(
						(a) =>
							a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
							a.address_line1.toLowerCase().includes(searchTerm.toLowerCase())
					);
					if (filtered[index]) {
						this.setState({
							activeModal: "address_details",
							viewAddressId: filtered[index].name,
							returnToModal: "address",
						});
					}
				} else if (activeModal === "customer") {
					const filtered = this.customers.filter(
						(c) =>
							c.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
							c.name.toLowerCase().includes(searchTerm.toLowerCase())
					);
					if (filtered[index]) {
						// We need to fetch details? The customer object in list has basic details.
						// BUT `customer_details` modal relies on `this.state.customer`.
						// So we must set `this.state.customer` TEMPORARILY for viewing.
						// Wait, if we set `this.state.customer`, it might affect the form if the user cancels?
						// `this.state.customer` IS the selected customer for the invoice.

						// If I set `this.state.customer` here just to view, and then go back, it's fine IF I don't trigger other side effects (like fetching addresses for that customer yet).
						// But `customer_details` renders `this.state.shipping_addresses`.
						// So I DO need to fetch addresses if I want to show them in the details modal for a PREVIEWED customer.
						// This might be heavy?
						// The user expects to see details suitable for deciding.
						// Let's set it. The `loadShippingAddresses` is fast enough usually.
						const cust = filtered[index];
						this.state.customer = cust;
						// We also need to load addresses for this previewed customer
						this.loadShippingAddresses(cust.name); // This will update state.shipping_addresses
						// And set modal
						this.setState({
							activeModal: "customer_details",
							returnToModal: "customer",
						});
					}
				}
			});

			// Back to Customer Details from Address Details
			container.find(".btn-back-customer").on("click", (e) => {
				this.setState({
					activeModal: "customer_details",
					returnToModal: this.state.detailsParentReturn, // Restore parent's return context
				});
			});

			// Back to Address List
			container.find(".btn-back-address-list").on("click", (e) => {
				this.setState({ activeModal: "address" });
			});

			// Back to Customer List
			container.find(".btn-back-customer-list").on("click", (e) => {
				this.setState({ activeModal: "customer" });
			});

			if (this.state.activeModal === "save_options") {
				// Focus the first button for quick Enter key save
				setTimeout(() => container.find(".btn-save-new").focus(), 100);

				// Add arrow key navigation for save buttons
				container.find(".btn-save-new, .btn-save-close").on("keydown", (e) => {
					if (e.key === "ArrowDown" || e.key === "ArrowUp") {
						e.preventDefault();
						const isNew = $(e.target).hasClass("btn-save-new");
						container.find(isNew ? ".btn-save-close" : ".btn-save-new").focus();
					}
				});
			}

			const modalSearch = container.find("#modal_search");
			modalSearch.on("input", (e) => {
				this.state.searchTerm = e.target.value;
				this.state.selectedModalIndex = 0;
				this.renderModalResults();
			});

			// Force focus on search field
			setTimeout(() => {
				const input = container.find("#modal_search");
				input.focus();
				// Double ensure focus for some browsers
				if (document.activeElement !== input[0]) input.focus();
			}, 200);

			this.attachModalItemListeners();
		}
	}

	attachModalItemListeners() {
		$(this.container)
			.find(".modal-item")
			.on("click", (e) => {
				this.handleModalItemSelect(parseInt($(e.currentTarget).data("index")));
			});
	}

	attachGlobalShortcuts() {
		$(window)
			.off("keydown.invoice")
			.on("keydown.invoice", (e) => {
				// STRICT SCOPING: Only handle if target is within our app container OR a modal
				// EXCEPTION: If a modal is active, we should capture events regardless (to handle focus loss)
				const isWithinApp =
					$(e.target).closest("#invoice_entry_form, .custom-modal-overlay").length > 0;
				if (!isWithinApp && !this.state.activeModal) return;

				// Global handling for Modal Navigation (even if focus is lost)
				if (this.state.activeModal && this.state.activeModal !== "save_options") {
					if (["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(e.key)) {
						this.handleModalKeyDown(e);
						return;
					}
				}

				// Enter handling for navigation (except when selecting in search)
				if (e.key === "Enter") {
					const target = $(e.target);

					// If modal is open, let modal handler deal with it
					if (this.state.activeModal) {
						return;
					}

					if (
						target.id === "customer_field" ||
						target.closest("#customer_field").length
					) {
						e.preventDefault();
						this.setState({
							activeModal: "customer",
							searchTerm: "",
							selectedModalIndex: 0,
						});
					} else if (target.closest(".item-field").length) {
						e.preventDefault();
						const index = target.closest(".item-row").data("index");
						this.activeLineIndex = index;
						this.setState({
							activeModal: "item",
							searchTerm: "",
							selectedModalIndex: 0,
						});
					} else if (target.closest(".batch-field").length) {
						e.preventDefault();
						const index = target.closest(".item-row").data("index");
						const itm = this.state.items[index];
						if (itm.item_code) {
							this.activeLineIndex = index;
							this.loadBatches(itm.item_code);
						}
					} else if (target.hasClass("rate-input")) {
						const index = target.data("index");

						// Enter at rate input: ONLY Add row if it's the last row
						if (
							index === this.state.items.length - 1 &&
							this.state.items[index].item_code &&
							parseFloat(this.state.items[index].qty) > 0
						) {
							e.preventDefault();
							this.addNewLine();
						}
					}
				}

				// Ctrl + S or Ctrl + Enter to Save - strictly within app form
				if (
					(e.ctrlKey || e.metaKey) &&
					(e.key === "s" ||
						(e.key === "Enter" &&
							e.target.id !== "modal_search" &&
							!this.state.activeModal))
				) {
					e.preventDefault();
					this.saveInvoice();
				}

				// Esc handling
				if (e.key === "Escape") {
					// Prevent closing Sales Account modal with Escape
					if (this.state.activeModal === "sales_account") return;

					if (this.state.activeModal) {
						e.preventDefault();
						this.setState({ activeModal: null });
					} else if (isWithinApp) {
						if (confirm("Discard changes?")) this.resetForm();
					}
				}

				// F2 for Posting Date
				if (e.key === "F2") {
					const activeId = e.target.id;
					if (isWithinApp && (activeId === "posting_date" || e.altKey)) {
						e.preventDefault();
						const today = frappe.datetime.get_today();
						this.state.postingDate = today;
						$(this.container).find("#posting_date").val(today).focus();
					}
				}

				// Table Arrow keys navigation
				if (
					!this.state.activeModal &&
					["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)
				) {
					const focused = $(document.activeElement);
					const row = focused.closest(".item-row");
					if (row.length) {
						// Handle Vertical Navigation (Up/Down)
						if (e.key === "ArrowDown" || e.key === "ArrowUp") {
							e.preventDefault();
							const index = row.data("index");
							const nextIndex = e.key === "ArrowDown" ? index + 1 : index - 1;
							const nextRow = $(this.container).find(
								`.item-row[data-index="${nextIndex}"]`
							);
							if (nextRow.length) {
								const classList = focused.attr("class")
									? focused.attr("class").split(" ")
									: [];
								let selector = "";
								if (classList.includes("item-field")) selector = ".item-field";
								else if (classList.includes("batch-field"))
									selector = ".batch-field";
								else if (classList.includes("qty-input")) selector = ".qty-input";
								else if (classList.includes("rate-input"))
									selector = ".rate-input";

								if (selector) nextRow.find(selector).focus();
							}
						}
						// Handle Horizontal Navigation (Left/Right)
						else {
							const isInput = focused.is("input");
							// For inputs, allow default cursor movement unless Ctrl is pressed or input is empty
							if (isInput && !e.ctrlKey && focused.val() !== "") return;

							e.preventDefault();
							// Selectable fields in order
							const fields = row.find(
								".item-field, .batch-field, .qty-input, .rate-input"
							);
							const currentIndex = fields.index(focused);

							if (e.key === "ArrowRight") {
								if (currentIndex < fields.length - 1) {
									fields.eq(currentIndex + 1).focus();
								} else {
									// Wrap to next row's first item
									const nextRow = row.next(".item-row");
									if (nextRow.length) nextRow.find(".item-field").focus();
								}
							} else {
								// ArrowLeft
								if (currentIndex > 0) {
									fields.eq(currentIndex - 1).focus();
								} else {
									// Wrap to prev row's last item
									const prevRow = row.prev(".item-row");
									if (prevRow.length) prevRow.find(".rate-input").focus();
								}
							}
						}
					}
				}
			});
	}

	handleModalKeyDown(e) {
		const { activeModal, searchTerm, selectedModalIndex } = this.state;

		let list = [];
		if (activeModal === "customer") {
			list = this.customers.filter(
				(c) =>
					c.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
					c.name.toLowerCase().includes(searchTerm.toLowerCase())
			);
		} else if (activeModal === "item") {
			list = this.items_list.filter(
				(i) =>
					i.item_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
					i.name.toLowerCase().includes(searchTerm.toLowerCase())
			);
		} else if (activeModal === "batch") {
			list = this.batches.filter((b) =>
				b.name.toLowerCase().includes(searchTerm.toLowerCase())
			);
		} else if (activeModal === "address") {
			list = this.state.shipping_addresses.filter(
				(a) =>
					a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
					a.address_line1.toLowerCase().includes(searchTerm.toLowerCase())
			);
		} else if (activeModal === "sales_account") {
			list = this.income_accounts.filter(
				(a) =>
					a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
					a.account_name.toLowerCase().includes(searchTerm.toLowerCase())
			);
		}

		if (e.key === "ArrowDown") {
			e.preventDefault();
			const newIndex = Math.min(selectedModalIndex + 1, list.length - 1);
			this.state.selectedModalIndex = newIndex;
			this.renderModalResults();
			this.scrollToSelected();
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			const newIndex = Math.max(selectedModalIndex - 1, 0);
			this.state.selectedModalIndex = newIndex;
			this.renderModalResults();
			this.scrollToSelected();
		} else if (e.key === "Enter") {
			e.preventDefault();
			if (list.length > 0) {
				this.handleModalItemSelect(this.state.selectedModalIndex);
			}
		} else if (e.key === "Escape") {
			e.preventDefault();
			this.setState({ activeModal: null });
		}
	}

	scrollToSelected() {
		const selected = $(this.container).find(".modal-item.selected")[0];
		if (selected) selected.scrollIntoView({ behavior: "smooth", block: "nearest" });
	}

	handleModalItemSelect(index) {
		const { activeModal, searchTerm } = this.state;
		let filtered = [];

		if (activeModal === "customer") {
			filtered = this.customers.filter(
				(c) =>
					c.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
					c.name.toLowerCase().includes(searchTerm.toLowerCase())
			);
			if (filtered[index]) {
				const cust = filtered[index];
				this.state.customer = cust;
				this.state.shipping_address = null; // Clear address on customer change
				this.loadShippingAddresses(cust.name);
				this.calculateTaxesAndTotals();
				this.setState({ activeModal: null, searchTerm: "", selectedModalIndex: 0 });
			}
		} else if (activeModal === "item") {
			filtered = this.items_list.filter(
				(i) =>
					i.item_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
					i.name.toLowerCase().includes(searchTerm.toLowerCase())
			);
			if (filtered[index]) {
				const itm = filtered[index];
				this.state.items[this.activeLineIndex] = {
					...this.state.items[this.activeLineIndex],
					item_code: itm.name,
					item_name: itm.item_name,
					qty: this.state.items[this.activeLineIndex].qty || 1, // Default qty to 1
					rate: itm.standard_rate || 0, // Use the fetched price
					uom: itm.stock_uom,
					income_account: this.state.sales_account, // Use selected sales account
				};
				if (itm.has_batch_no) {
					this.loadBatches(itm.name);
				} else {
					this.calculateTaxesAndTotals(); // Trigger rate fetch
					this.setState({ activeModal: null, searchTerm: "", selectedModalIndex: 0 });
					setTimeout(
						() =>
							$(this.container)
								.find(`.qty-input[data-index="${this.activeLineIndex}"]`)
								.focus(),
						50
					);
				}
			}
		} else if (activeModal === "address") {
			filtered = this.state.shipping_addresses.filter(
				(a) =>
					a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
					a.address_line1.toLowerCase().includes(searchTerm.toLowerCase())
			);
			if (filtered[index]) {
				this.state.shipping_address = filtered[index].name;
				this.setState({ activeModal: null, searchTerm: "", selectedModalIndex: 0 });
				setTimeout(() => $(this.container).find(".item-field").first().focus(), 100);
			}
		} else if (activeModal === "batch") {
			filtered = this.batches.filter((b) =>
				b.name.toLowerCase().includes(searchTerm.toLowerCase())
			);
			if (filtered[index]) {
				this.state.items[this.activeLineIndex].batch_no = filtered[index].name;
				this.calculateTaxesAndTotals(); // Sync rate/tax after batch select
				this.setState({ activeModal: null, searchTerm: "", selectedModalIndex: 0 });
				setTimeout(
					() =>
						$(this.container)
							.find(`.qty-input[data-index="${this.activeLineIndex}"]`)
							.focus(),
					50
				);
			}
		} else if (activeModal === "sales_account") {
			filtered = this.income_accounts.filter(
				(a) =>
					a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
					a.account_name.toLowerCase().includes(searchTerm.toLowerCase())
			);
			if (filtered[index]) {
				this.setState({
					sales_account: filtered[index].name,
					activeModal: null,
					searchTerm: "",
					selectedModalIndex: 0,
				});
				// Auto-focus posting date after selecting account
				setTimeout(() => $(this.container).find("#posting_date").focus(), 100);
			}
		}
	}

	loadBatches(itemCode) {
		frappe.call({
			method: "bd_custom.bd_custom.page.sales_invoice_entry.sales_invoice_entry.get_batch_list",
			args: { item_code: itemCode },
			callback: (r) => {
				if (r.message) {
					this.batches = r.message;
					this.setState({ activeModal: "batch", searchTerm: "", selectedModalIndex: 0 });
				}
			},
		});
	}

	calculateSubtotal() {
		return this.state.items.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);
	}
	calculateTotalTax() {
		return this.state.total_taxes_and_charges || 0;
	}
	calculateGrandTotal() {
		return this.state.grand_total || this.calculateSubtotal() + this.calculateTotalTax();
	}

	calculateTaxesAndTotals() {
		if (!this.state.customer) return;

		const validItems = this.state.items.filter((i) => i.item_code && parseFloat(i.qty) > 0);
		if (validItems.length === 0) {
			// Clear taxes if no items
			this.state.taxes = [];
			this.state.taxes_and_charges = "";
			this.updateTotalsOnly();
			return;
		}

		const items = validItems.map((i) => ({
			item_code: i.item_code,
			qty: parseFloat(i.qty),
			rate: parseFloat(i.rate),
			batch_no: i.batch_no,
			income_account: i.income_account || this.state.sales_account,
		}));

		frappe.call({
			method: "bd_custom.bd_custom.page.sales_invoice_entry.sales_invoice_entry.calculate_invoice_taxes",
			args: {
				customer: this.state.customer.name,
				items: items,
				posting_date: this.state.postingDate,
				shipping_address_name: this.state.shipping_address,
				company: this.state.company,
			},
			callback: (r) => {
				if (r.message) {
					this.state.taxes = r.message.taxes || [];
					this.state.taxes_and_charges = r.message.taxes_and_charges || "";
					this.state.net_total = r.message.net_total || 0;
					this.state.total_taxes_and_charges = r.message.total_taxes_and_charges || 0;
					this.state.grand_total = r.message.grand_total || 0;
					this.state.rounded_total = r.message.rounded_total || 0;
					this.state.rounding_adjustment = r.message.rounding_adjustment || 0;

					// Sync calculated item amounts (important for inclusive taxes and auto-populating rates)
					if (r.message.items) {
						r.message.items.forEach((calc_item, i) => {
							if (this.state.items[i]) {
								this.state.items[i].amount = calc_item.amount;
								this.state.items[i].total_amount = calc_item.total_amount;
								// Update rate if server provided a different one (e.g. from Price List)
								if (
									calc_item.rate &&
									(!this.state.items[i].rate ||
										parseFloat(this.state.items[i].rate) === 0)
								) {
									this.state.items[i].rate = calc_item.rate;
								}
							}
						});
					}

					this.updateTotalsOnly();
					this.refreshLineAmounts();
				}
			},
		});
	}

	calculateLineAmount(index, autoAdd = true) {
		const i = this.state.items[index];
		const qty = parseFloat(i.qty) || 0;
		const rate = parseFloat(i.rate) || 0;
		const amount = qty * rate;
		i.amount = amount;
		i.total_amount = amount; // Local fallback
		this.updateLineAmount(index);

		// Trigger server-side tax calculation
		this.calculateTaxesAndTotals();

		// Auto-add new row only if requested and last row is filled
		if (autoAdd && index === this.state.items.length - 1 && i.item_code && qty > 0) {
			this.addNewLine();
		}
	}

	addNewLine() {
		this.setState({
			items: [
				...this.state.items,
				{
					id: Date.now(),
					item_code: null,
					item_name: "",
					batch_no: null,
					qty: "",
					rate: "",
					uom: "",
					amount: 0,
					tax_amount: 0,
					total_amount: 0,
					income_account: this.state.sales_account,
				},
			],
		});
		// Focus the new row's item field
		setTimeout(() => {
			$(this.container).find(".item-row").last().find(".item-field").focus();
		}, 100);
	}

	resetForm() {
		window.location.reload();
	}

	validateInvoice() {
		if (!this.state.customer) {
			frappe.msgprint(__("Select Customer"));
			return false;
		}
		const validItems = this.state.items.filter((i) => i.item_code && parseFloat(i.qty) > 0);
		if (validItems.length === 0) {
			frappe.msgprint(__("Add at least one item"));
			return false;
		}
		return true;
	}

	executeSave(action) {
		this.setState({ saving: true });

		const invoiceData = {
			customer: this.state.customer.name,
			posting_date: this.state.postingDate,
			shipping_address_name: this.state.shipping_address,
			taxes_and_charges: this.state.taxes_and_charges,
			company: this.state.company,
			items: this.state.items
				.filter((i) => i.item_code && parseFloat(i.qty) > 0)
				.map((i) => ({
					item_code: i.item_code,
					qty: parseFloat(i.qty),
					rate: parseFloat(i.rate),
					batch_no: i.batch_no,
					income_account: i.income_account || this.state.sales_account,
				})),
			remarks: this.state.remarks,
		};

		frappe.call({
			method: "bd_custom.bd_custom.page.sales_invoice_entry.sales_invoice_entry.save_sales_invoice",
			args: { doc: invoiceData },
			callback: (r) => {
				this.setState({ saving: false, activeModal: null });
				if (r.message) {
					frappe.show_alert({
						message: __("Invoice {0} saved", [r.message]),
						indicator: "green",
					});
					if (action === "new") {
						this.resetForm();
					} else {
						// Close / Redirect back to list
						frappe.set_route("List", "Sales Invoice");
					}
				}
			},
			error: () => this.setState({ saving: false }),
		});
	}

	saveInvoice() {
		this.setState({ activeModal: "save_options" });
	}
}
