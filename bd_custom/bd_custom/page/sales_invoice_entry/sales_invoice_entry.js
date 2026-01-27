frappe.pages['sales-invoice-entry'].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		single_column: true
	});

	const container = $('<div id="sales-invoice-react-root"></div>').appendTo(page.main);
	new SalesInvoiceApp(container[0], page);
};

class SalesInvoiceApp {
	constructor(container, page) {
		this.container = container;
		this.page = page;
		this.state = {
			invoiceNo: '',
			postingDate: frappe.datetime.get_today(),
			customer: null,
			shipping_address: null,
			shipping_addresses: [],
			items: [{
				id: 1,
				item_code: null,
				item_name: '',
				batch_no: null,
				qty: '',
				rate: '',
				uom: '',
				amount: 0,
				tax_amount: 0,
				total_amount: 0
			}],
			remarks: '',
			saving: false,
			activeModal: null,
			searchTerm: '',
			selectedModalIndex: 0,
			taxes: [],
			net_total: 0,
			total_taxes_and_charges: 0,
			grand_total: 0
		};

		this.customers = [];
		this.items_list = [];
		this.batches = [];
		this.activeLineIndex = 0;

		this.loadData();
		this.render();
		this.attachEventListeners();
		this.attachGlobalShortcuts();
	}

	loadData() {
		// Load customers
		frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Customer',
				fields: ['name', 'customer_name', 'tax_id'],
				limit_page_length: 0
			},
			callback: (r) => {
				if (r.message) {
					this.customers = r.message;
				}
			}
		});

		// Load items
		frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Item',
				fields: ['name', 'item_name', 'standard_rate', 'stock_uom', 'has_batch_no'],
				limit_page_length: 0
			},
			callback: (r) => {
				if (r.message) {
					this.items_list = r.message;
				}
			}
		});
	}

	loadShippingAddresses(customerName) {
		frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Address',
				filters: [
					['Dynamic Link', 'link_doctype', '=', 'Customer'],
					['Dynamic Link', 'link_name', '=', customerName]
				],
				fields: ['name', 'address_line1', 'address_line2', 'city', 'state', 'pincode']
			},
			callback: (res) => {
				if (res.message) {
					const addresses = res.message;
					this.state.shipping_addresses = addresses;

					if (addresses.length === 1) {
						this.state.shipping_address = addresses[0].name;
						this.render();
						this.attachEventListeners();
						// Auto-focus first item field if only one address
						setTimeout(() => $(this.container).find('.item-field').first().focus(), 100);
					} else if (addresses.length > 1) {
						// Auto-open address modal
						this.setState({ activeModal: 'address', searchTerm: '', selectedModalIndex: 0 });
					}
				}
			}
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
		container.find('#subtotal').text(this.calculateSubtotal().toFixed(2));
		container.find('#grand_total').text(this.calculateGrandTotal().toFixed(2));

		// Dynamically render tax rows
		const taxRowsContainer = container.find('#tax_rows');
		if (taxRowsContainer.length) {
			const taxHTML = this.state.taxes.map(tax => `
				<div class="total-row">
					<span>${tax.description}</span>
					<span>₹${(tax.tax_amount || 0).toFixed(2)}</span>
				</div>
			`).join('');
			taxRowsContainer.html(taxHTML);
		}
	}

	// Update single line amount without full re-render
	updateLineAmount(index) {
		const item = this.state.items[index];
		const container = $(this.container);
		container.find(`.amount-display[data-index="${index}"]`).val(item.total_amount.toFixed(2));
		container.find(`.amount-display[data-index="${index}"]`).attr('title', `Base: ₹${item.amount.toFixed(2)} + Tax: ₹${item.tax_amount.toFixed(2)}`);
		this.updateTotalsOnly();
	}

	render() {
		const { invoiceNo, postingDate, customer, shipping_address, shipping_addresses, items, remarks, saving, activeModal, searchTerm, selectedModalIndex } = this.state;

		this.container.innerHTML = `
			<div class="invoice-entry-container" id="invoice_entry_form">
				<div class="invoice-form">
					<!-- Header -->
					<div class="form-header">
						<h2>Sales Invoice</h2>
						<div class="shortcuts-info">
							<span><kbd>F2</kbd> Today</span>
							<span><kbd>Enter</kbd> Navigate</span>
							<span><kbd>↑↓</kbd> Move</span>
							<span><kbd>Ctrl+S</kbd> Save</span>
							<span><kbd>Esc</kbd> Cancel</span>
						</div>
					</div>

					<!-- Form Body -->
					<div class="form-body">
						<div class="row mb-3">
							<div class="col-md-6 form-group">
								<label>Invoice No / ID</label>
								<input type="text" id="invoice_no" class="form-control" style="width: 100%;" value="${invoiceNo}" placeholder="Auto-generated (Enter to accept)">
							</div>
							<div class="col-md-6 form-group">
								<label>Posting Date (F2 today)</label>
								<input type="date" id="posting_date" class="form-control" style="width: 100%;" value="${postingDate}">
							</div>
						</div>

						<div class="row mb-3">
							<div class="col-md-12 form-group">
								<label>Customer</label>
								<div id="customer_field" class="form-control custom-field" style="width: 100%;" tabindex="0">
									${customer ? `
										<div style="display: flex; flex-direction: column;">
											<span class="modal-item-title">${customer.customer_name}</span>
											<span class="modal-item-subtitle">${customer.name}</span>
										</div>
									` : '<span style="color: #9ca3af;">Select Customer (Enter to open list)...</span>'}
								</div>
							</div>
						</div>

						${customer ? `
							<div class="row mb-3 shipping-address-container">
								<div class="col-md-12 form-group">
									<label>Shipping Address</label>
									<div id="address_field" class="form-control custom-field" style="width: 100%;" tabindex="0">
										${shipping_address ? `
											<div style="display: flex; flex-direction: column;">
												<span class="modal-item-title">${shipping_address}</span>
												<span class="modal-item-subtitle">${shipping_addresses.find(a => a.name === shipping_address)?.address_line1 || ''}</span>
											</div>
										` : '<span style="color: #9ca3af;">Select Shipping Address (Enter to open)...</span>'}
									</div>
								</div>
							</div>
						` : ''}
						<!-- Items Table -->
						<div class="items-table-container">
							<div class="table-head">
								<div>Item</div>
								<div>Batch No</div>
								<div>Qty</div>
								<div>Rate</div>
								<div>Amount (Inc. Tax)</div>
							</div>
							<div id="item-rows">
								${items.map((item, index) => `
									<div class="item-row" data-index="${index}">
										<div class="item-field custom-field" data-index="${index}" tabindex="0">
											<span style="color: ${item.item_name ? 'inherit' : '#9ca3af'};">${item.item_name || 'Select Item...'}</span>
										</div>
										<div class="batch-field custom-field" data-index="${index}" tabindex="0" style="background: ${item.item_code ? 'inherit' : '#f9fafb'};">
											<span style="color: ${item.batch_no ? 'inherit' : '#9ca3af'};">${item.batch_no || 'Batch...'}</span>
										</div>
										<input type="number" class="qty-input" data-index="${index}" value="${item.qty}" placeholder="0" ${!item.item_code ? 'disabled' : ''}>
										<input type="number" class="rate-input" data-index="${index}" value="${item.rate}" placeholder="0.00" ${!item.item_code ? 'disabled' : ''}>
										<input type="number" class="amount-display" data-index="${index}" value="${item.total_amount.toFixed(2)}" readonly>
									</div>
								`).join('')}
							</div>
						</div>

						<!-- Totals -->
						<div class="totals-section">
							<div class="totals-table">
								<div class="total-row">
									<span>Subtotal</span>
									<span>₹<span id="subtotal">${this.calculateSubtotal().toFixed(2)}</span></span>
								</div>
								<div id="tax_rows"></div>
								<div class="total-row grand-total">
									<span>Grand Total</span>
									<span>₹<span id="grand_total">${this.calculateGrandTotal().toFixed(2)}</span></span>
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
							<button class="btn btn-primary btn-save" ${saving ? 'disabled' : ''}>
								${saving ? 'Saving...' : 'Save'}
							</button>
						</div>
					</div>
				</div>

				${activeModal ? this.renderModal() : ''}
			</div>
		`;
	}

	renderModal() {
		const { activeModal, searchTerm } = this.state;
		let title = '';

		if (activeModal === 'customer') title = 'Select Customer';
		else if (activeModal === 'item') title = 'Select Item';
		else if (activeModal === 'batch') title = 'Select Batch';
		else if (activeModal === 'address') title = 'Select Shipping Address';
		return `
			<div class="custom-modal-overlay">
				<div class="custom-modal-content">
					<div class="modal-header">
						<h3 style="margin: 0; font-size: 16px;">${title}</h3>
						<button class="modal-close btn-secondary" style="padding: 2px 8px; border: none;">&times;</button>
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

		if (activeModal === 'customer') {
			list = this.customers.filter(c =>
				c.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
				c.name.toLowerCase().includes(searchTerm.toLowerCase())
			);
		} else if (activeModal === 'item') {
			list = this.items_list.filter(i =>
				i.item_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
				i.name.toLowerCase().includes(searchTerm.toLowerCase())
			);
		} else if (activeModal === 'batch') {
			list = this.batches.filter(b => b.toLowerCase().includes(searchTerm.toLowerCase()));
		} else if (activeModal === 'address') {
			list = this.state.shipping_addresses.filter(a =>
				a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
				a.address_line1.toLowerCase().includes(searchTerm.toLowerCase())
			);
		}

		if (list.length === 0) return '<div style="padding: 20px; text-align: center; color: var(--light-text);">No results</div>';

		return list.map((item, index) => {
			const isSelected = index === selectedModalIndex;
			if (activeModal === 'customer') {
				return `<div class="modal-item ${isSelected ? 'selected' : ''}" data-index="${index}">
					<div class="modal-item-title">${item.customer_name}</div>
					<div class="modal-item-subtitle">${item.name}</div>
				</div>`;
			} else if (activeModal === 'item') {
				return `<div class="modal-item ${isSelected ? 'selected' : ''}" data-index="${index}">
					<div class="modal-item-title">${item.item_name}</div>
					<div class="modal-item-subtitle">${item.name} | ₹${item.standard_rate || 0}</div>
				</div>`;
			} else if (activeModal === 'address') {
				return `<div class="modal-item ${isSelected ? 'selected' : ''}" data-index="${index}">
					<div class="modal-item-title">${item.name}</div>
					<div class="modal-item-subtitle">${item.address_line1}</div>
				</div>`;
			} else {
				return `<div class="modal-item ${isSelected ? 'selected' : ''}" data-index="${index}">
					<div class="modal-item-title">${item}</div>
				</div>`;
			}
		}).join('');
	}

	renderModalResults() {
		const container = $(this.container).find('#modal_results');
		if (container.length) {
			container.html(this.getModalResultsHTML());
			this.attachModalItemListeners();
		}
	}

	attachEventListeners() {
		const container = $(this.container);

		container.find('#invoice_no').on('input', (e) => this.state.invoiceNo = e.target.value);
		container.find('#posting_date').on('change', (e) => this.state.postingDate = e.target.value);

		container.find('#customer_field').on('click', () => {
			this.setState({ activeModal: 'customer', searchTerm: '', selectedModalIndex: 0 });
		});

		container.find('#address_field').on('click', () => {
			this.setState({ activeModal: 'address', searchTerm: '', selectedModalIndex: 0 });
		});
		container.find('.item-field').on('click', (e) => {
			this.activeLineIndex = parseInt($(e.currentTarget).data('index'));
			this.setState({ activeModal: 'item', searchTerm: '', selectedModalIndex: 0 });
		});

		container.find('.batch-field').on('click', (e) => {
			const index = parseInt($(e.currentTarget).data('index'));
			const item = this.state.items[index];
			if (item.item_code) {
				this.activeLineIndex = index;
				this.loadBatches(item.item_code);
			}
		});

		container.find('.qty-input').on('input', (e) => {
			const index = parseInt($(e.target).data('index'));
			this.state.items[index].qty = e.target.value;
			this.calculateLineAmount(index, false); // Pass false to not auto-add row on every qty input
		});

		container.find('.rate-input').on('input', (e) => {
			const index = parseInt($(e.target).data('index'));
			this.state.items[index].rate = e.target.value;
			this.calculateLineAmount(index, false);
		});

		container.find('#remarks').on('input', (e) => this.state.remarks = e.target.value);

		container.find('.btn-save').on('click', () => this.saveInvoice());
		container.find('.btn-cancel').on('click', () => {
			if (confirm('Discard changes?')) this.resetForm();
		});

		if (this.state.activeModal) {
			container.find('.modal-close').on('click', () => this.setState({ activeModal: null }));

			const modalSearch = container.find('#modal_search');
			modalSearch.on('input', (e) => {
				this.state.searchTerm = e.target.value;
				this.state.selectedModalIndex = 0;
				this.renderModalResults();
			}).on('keydown', (e) => this.handleModalKeyDown(e));

			// Force focus on search field
			setTimeout(() => modalSearch.focus(), 100);

			this.attachModalItemListeners();
		}
	}

	attachModalItemListeners() {
		$(this.container).find('.modal-item').on('click', (e) => {
			this.handleModalItemSelect(parseInt($(e.currentTarget).data('index')));
		});
	}

	attachGlobalShortcuts() {
		$(window).off('keydown.invoice').on('keydown.invoice', (e) => {
			// STRICT SCOPING: Only handle if target is within our app container OR a modal
			const isWithinApp = $(e.target).closest('#invoice_entry_form, .custom-modal-overlay').length > 0;
			if (!isWithinApp) return;

			// Enter handling for navigation (except when selecting in search)
			if (e.key === 'Enter') {
				const target = $(e.target);

				// If modal is open, let modal handler deal with it
				if (this.state.activeModal) {
					return;
				}

				if (target.id === 'invoice_no' || target.id === 'posting_date') {
					e.preventDefault();
					const next = target.id === 'invoice_no' ? '#posting_date' : '#customer_field';
					$(this.container).find(next).focus();
				} else if (target.id === 'customer_field' || target.closest('#customer_field').length) {
					e.preventDefault();
					this.setState({ activeModal: 'customer', searchTerm: '', selectedModalIndex: 0 });
				} else if (target.id === 'address_field' || target.closest('#address_field').length) {
					e.preventDefault();
					this.setState({ activeModal: 'address', searchTerm: '', selectedModalIndex: 0 });
				} else if (target.closest('.item-field').length) {
					e.preventDefault();
					const index = target.closest('.item-row').data('index');
					this.activeLineIndex = index;
					this.setState({ activeModal: 'item', searchTerm: '', selectedModalIndex: 0 });
				} else if (target.closest('.batch-field').length) {
					e.preventDefault();
					const index = target.closest('.item-row').data('index');
					const itm = this.state.items[index];
					if (itm.item_code) {
						this.activeLineIndex = index;
						this.loadBatches(itm.item_code);
					}
				} else if (target.hasClass('rate-input')) {
					e.preventDefault();
					const index = target.data('index');

					// Enter at rate input: Add row or move to next
					if (index === this.state.items.length - 1 && this.state.items[index].item_code && parseFloat(this.state.items[index].qty) > 0) {
						this.addNewLine();
					} else if (index < this.state.items.length - 1) {
						$(this.container).find(`.item-row[data-index="${index + 1}"] .item-field`).focus();
					} else {
						$(this.container).find('#remarks').focus();
					}
				}
			}

			// Tab handling for last row row addition
			if (e.key === 'Tab' && !e.shiftKey) {
				const target = $(e.target);
				if (target.hasClass('rate-input')) {
					const index = target.data('index');
					if (index === this.state.items.length - 1 && this.state.items[index].item_code && parseFloat(this.state.items[index].qty) > 0) {
						e.preventDefault();
						this.addNewLine();
					}
				}
			}

			// Modal-specific Arrow Navigation (when modal search is focused)
			if (this.state.activeModal && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
				e.preventDefault();
				this.handleModalKeyDown(e);
				return;
			}

			// Ctrl + S or Ctrl + Enter to Save - strictly within app form
			if ((e.ctrlKey || e.metaKey) && (e.key === 's' || (e.key === 'Enter' && e.target.id !== 'modal_search' && !this.state.activeModal))) {
				e.preventDefault();
				this.saveInvoice();
			}

			// Esc handling
			if (e.key === 'Escape') {
				if (this.state.activeModal) {
					e.preventDefault();
					this.setState({ activeModal: null });
				} else if (isWithinApp) {
					if (confirm('Discard changes?')) this.resetForm();
				}
			}

			// F2 for Posting Date
			if (e.key === 'F2') {
				const activeId = e.target.id;
				if (isWithinApp && (activeId === 'posting_date' || e.altKey)) {
					e.preventDefault();
					const today = frappe.datetime.get_today();
					this.state.postingDate = today;
					$(this.container).find('#posting_date').val(today).focus();
				}
			}

			// Table Arrow keys navigation
			if (!this.state.activeModal && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
				const focused = $(document.activeElement);
				const row = focused.closest('.item-row');
				if (row.length) {
					e.preventDefault();
					const index = row.data('index');
					const nextIndex = e.key === 'ArrowDown' ? index + 1 : index - 1;
					const nextRow = $(this.container).find(`.item-row[data-index="${nextIndex}"]`);
					if (nextRow.length) {
						const classList = focused.attr('class') ? focused.attr('class').split(' ') : [];
						let selector = '';
						if (classList.includes('item-field')) selector = '.item-field';
						else if (classList.includes('batch-field')) selector = '.batch-field';
						else if (classList.includes('qty-input')) selector = '.qty-input';
						else if (classList.includes('rate-input')) selector = '.rate-input';

						if (selector) nextRow.find(selector).focus();
					}
				}
			}
		});
	}

	handleModalKeyDown(e) {
		const { activeModal, searchTerm, selectedModalIndex } = this.state;

		let list = [];
		if (activeModal === 'customer') {
			list = this.customers.filter(c => c.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) || c.name.toLowerCase().includes(searchTerm.toLowerCase()));
		} else if (activeModal === 'item') {
			list = this.items_list.filter(i => i.item_name.toLowerCase().includes(searchTerm.toLowerCase()) || i.name.toLowerCase().includes(searchTerm.toLowerCase()));
		} else if (activeModal === 'batch') {
			list = this.batches.filter(b => b.toLowerCase().includes(searchTerm.toLowerCase()));
		} else if (activeModal === 'address') {
			list = this.state.shipping_addresses.filter(a => a.name.toLowerCase().includes(searchTerm.toLowerCase()) || a.address_line1.toLowerCase().includes(searchTerm.toLowerCase()));
		}

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			const newIndex = Math.min(selectedModalIndex + 1, list.length - 1);
			this.state.selectedModalIndex = newIndex;
			this.renderModalResults();
			this.scrollToSelected();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			const newIndex = Math.max(selectedModalIndex - 1, 0);
			this.state.selectedModalIndex = newIndex;
			this.renderModalResults();
			this.scrollToSelected();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (list.length > 0) {
				this.handleModalItemSelect(this.state.selectedModalIndex);
			}
		} else if (e.key === 'Escape') {
			e.preventDefault();
			this.setState({ activeModal: null });
		}
	}

	scrollToSelected() {
		const selected = $(this.container).find('.modal-item.selected')[0];
		if (selected) selected.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}

	handleModalItemSelect(index) {
		const { activeModal, searchTerm } = this.state;
		let filtered = [];

		if (activeModal === 'customer') {
			filtered = this.customers.filter(c => c.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) || c.name.toLowerCase().includes(searchTerm.toLowerCase()));
			if (filtered[index]) {
				const cust = filtered[index];
				this.state.customer = cust;
				this.loadShippingAddresses(cust.name);
				this.setState({ activeModal: null, searchTerm: '', selectedModalIndex: 0 });
			}
		} else if (activeModal === 'item') {
			filtered = this.items_list.filter(i => i.item_name.toLowerCase().includes(searchTerm.toLowerCase()) || i.name.toLowerCase().includes(searchTerm.toLowerCase()));
			if (filtered[index]) {
				const itm = filtered[index];
				this.state.items[this.activeLineIndex] = {
					...this.state.items[this.activeLineIndex],
					item_code: itm.name,
					item_name: itm.item_name,
					rate: itm.standard_rate || 0,
					uom: itm.stock_uom
				};
				if (itm.has_batch_no) {
					this.loadBatches(itm.name);
				} else {
					this.setState({ activeModal: null, searchTerm: '', selectedModalIndex: 0 });
					setTimeout(() => $(this.container).find(`.qty-input[data-index="${this.activeLineIndex}"]`).focus(), 50);
				}
			}
		} else if (activeModal === 'address') {
			filtered = this.state.shipping_addresses.filter(a => a.name.toLowerCase().includes(searchTerm.toLowerCase()) || a.address_line1.toLowerCase().includes(searchTerm.toLowerCase()));
			if (filtered[index]) {
				this.state.shipping_address = filtered[index].name;
				this.setState({ activeModal: null, searchTerm: '', selectedModalIndex: 0 });
				setTimeout(() => $(this.container).find('.item-field').first().focus(), 100);
			}
		} else if (activeModal === 'batch') {
			filtered = this.batches.filter(b => b.toLowerCase().includes(searchTerm.toLowerCase()));
			if (filtered[index]) {
				this.state.items[this.activeLineIndex].batch_no = filtered[index];
				this.setState({ activeModal: null, searchTerm: '', selectedModalIndex: 0 });
				setTimeout(() => $(this.container).find(`.qty-input[data-index="${this.activeLineIndex}"]`).focus(), 50);
			}
		}
	}

	loadBatches(itemCode) {
		frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Batch',
				filters: { item: itemCode },
				fields: ['name']
			},
			callback: (r) => {
				if (r.message) {
					this.batches = r.message.map(b => b.name);
					this.setState({ activeModal: 'batch', searchTerm: '', selectedModalIndex: 0 });
				}
			}
		});
	}

	calculateSubtotal() { return this.state.items.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0); }
	calculateTotalTax() { return this.state.total_taxes_and_charges || 0; }
	calculateGrandTotal() { return this.state.grand_total || (this.calculateSubtotal() + this.calculateTotalTax()); }

	calculateTaxesAndTotals() {
		if (!this.state.customer) return;

		const validItems = this.state.items.filter(i => i.item_code && parseFloat(i.qty) > 0);
		if (validItems.length === 0) return;

		const items = validItems.map(i => ({
			item_code: i.item_code,
			qty: parseFloat(i.qty),
			rate: parseFloat(i.rate),
			batch_no: i.batch_no
		}));

		frappe.call({
			method: 'bd_custom.bd_custom.page.sales_invoice_entry.sales_invoice_entry.calculate_invoice_taxes',
			args: {
				customer: this.state.customer.name,
				items: items,
				posting_date: this.state.postingDate,
				shipping_address_name: this.state.shipping_address
			},
			callback: (r) => {
				if (r.message) {
					this.state.taxes = r.message.taxes || [];
					this.state.net_total = r.message.net_total || 0;
					this.state.total_taxes_and_charges = r.message.total_taxes_and_charges || 0;
					this.state.grand_total = r.message.grand_total || 0;
					this.updateTotalsOnly();
				}
			}
		});
	}

	calculateLineAmount(index, autoAdd = true) {
		const i = this.state.items[index];
		const qty = parseFloat(i.qty) || 0;
		const rate = parseFloat(i.rate) || 0;
		const amount = qty * rate;
		i.amount = amount;
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
			items: [...this.state.items, {
				id: Date.now(), item_code: null, item_name: '', batch_no: null,
				qty: '', rate: '', uom: '', amount: 0, tax_amount: 0, total_amount: 0
			}]
		});
		// Focus the new row's item field
		setTimeout(() => {
			$(this.container).find('.item-row').last().find('.item-field').focus();
		}, 100);
	}

	resetForm() {
		window.location.reload();
	}

	validateInvoice() {
		if (!this.state.customer) { frappe.msgprint(__('Select Customer')); return false; }
		const validItems = this.state.items.filter(i => i.item_code && parseFloat(i.qty) > 0);
		if (validItems.length === 0) { frappe.msgprint(__('Add at least one item')); return false; }
		return true;
	}

	saveInvoice() {
		if (!this.validateInvoice()) return;
		this.setState({ saving: true });

		const invoiceData = {
			doctype: 'Sales Invoice',
			customer: this.state.customer.name,
			posting_date: this.state.postingDate,
			update_stock: 1,
			shipping_address_name: this.state.shipping_address,
			items: this.state.items.filter(i => i.item_code && parseFloat(i.qty) > 0).map(i => ({
				item_code: i.item_code,
				qty: parseFloat(i.qty),
				rate: parseFloat(i.rate),
				batch_no: i.batch_no
			})),
			remarks: this.state.remarks
		};

		frappe.call({
			method: 'frappe.client.insert',
			args: { doc: invoiceData },
			callback: (r) => {
				this.setState({ saving: false });
				if (r.message) {
					frappe.show_alert({ message: __('Invoice {0} saved', [r.message.name]), indicator: 'green' });
					this.resetForm();
				}
			},
			error: () => this.setState({ saving: false })
		});
	}
}