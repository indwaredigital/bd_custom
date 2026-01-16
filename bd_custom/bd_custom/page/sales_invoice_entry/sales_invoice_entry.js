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
			selectedModalIndex: 0
		};

		this.customers = [];
		this.items_list = [];
		this.batches = [];
		this.activeLineIndex = 0;

		this.loadData();
		this.render();
		this.attachEventListeners();
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

	setState(newState) {
		this.state = { ...this.state, ...newState };
		this.render();
		this.attachEventListeners();
	}

	// Only update totals without full re-render
	updateTotalsOnly() {
		const container = $(this.container);
		container.find('#subtotal').text(this.calculateSubtotal().toFixed(2));
		container.find('#total_tax').text(this.calculateTotalTax().toFixed(2));
		container.find('#grand_total').text(this.calculateGrandTotal().toFixed(2));
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
		const { invoiceNo, postingDate, customer, items, remarks, saving, activeModal, searchTerm, selectedModalIndex } = this.state;

		this.container.innerHTML = `
			<div class="invoice-entry-container" style="background: #f9fafb; padding: 20px; min-height: 100vh;">
				<div class="invoice-form" style="max-width: 1200px; margin: 0 auto; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
					<!-- Header -->
					<div class="form-header" style="background: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
						<h2 style="margin: 0; font-size: 24px; font-weight: 600; color: white;">Sales Invoice</h2>
						<p style="margin: 5px 0 0; font-size: 13px; opacity: 0.9;">Press F1 for Help | Tab to navigate | Enter to select</p>
					</div>

					<!-- Form Body -->
					<div class="form-body" style="padding: 24px;">
						<!-- Invoice No & Date -->
						<div class="row mb-3">
							<div class="col-md-6">
								<label class="form-label" style="font-weight: 600; font-size: 13px; color: #374151; margin-bottom: 6px; display: block;">
									Invoice No / ID
								</label>
								<input 
									type="text" 
									id="invoice_no" 
									class="form-control" 
									value="${invoiceNo}" 
									placeholder="Auto-generated or enter custom"
									autofocus
								>
							</div>
							<div class="col-md-6">
								<label class="form-label" style="font-weight: 600; font-size: 13px; color: #374151; margin-bottom: 6px; display: block;">
									Posting Date <span style="color: #2563eb; font-size: 11px;">(Press F2 for today)</span>
								</label>
								<input 
									type="date" 
									id="posting_date" 
									class="form-control" 
									value="${postingDate}"
								>
							</div>
						</div>

						<!-- Customer -->
						<div class="mb-3">
							<label class="form-label" style="font-weight: 600; font-size: 13px; color: #374151; margin-bottom: 6px; display: block;">
								Customer <span style="color: #2563eb; font-size: 11px;">(Press Enter to select)</span>
							</label>
							<div 
								id="customer_field" 
								class="form-control" 
								tabindex="0" 
								style="cursor: pointer; min-height: 50px; display: flex; align-items: center;"
							>
								${customer ? `
									<div>
										<div style="font-weight: 600;">${customer.customer_name}</div>
										<div style="font-size: 11px; color: #6b7280;">${customer.name}${customer.tax_id ? ' | GSTIN: ' + customer.tax_id : ''}</div>
									</div>
								` : '<span style="color: #9ca3af;">Select Customer...</span>'}
							</div>
						</div>

						<!-- Items Table -->
						<div class="mb-3" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden;">
							<div style="background: #f9fafb; padding: 12px 16px; border-bottom: 1px solid #e5e7eb;">
								<h4 style="margin: 0; font-size: 14px; font-weight: 600; color: #374151;">Invoice Items</h4>
							</div>
							<div style="padding: 16px;">
								<!-- Table Header -->
								<div style="display: grid; grid-template-columns: 3fr 2fr 2fr 2fr 3fr; gap: 8px; margin-bottom: 12px; font-size: 13px; font-weight: 600; color: #6b7280;">
									<div>Item</div>
									<div>Batch No</div>
									<div>Quantity</div>
									<div>Rate</div>
									<div>Amount (Inc. Tax)</div>
								</div>

								<!-- Items -->
								${items.map((item, index) => `
									<div class="item-row" data-index="${index}" style="display: grid; grid-template-columns: 3fr 2fr 2fr 2fr 3fr; gap: 8px; margin-bottom: 12px;">
										<!-- Item -->
										<div 
											class="item-field" 
											data-index="${index}" 
											tabindex="0" 
											style="padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 4px; cursor: pointer; font-size: 13px; min-height: 38px; display: flex; align-items: center;"
										>
											<span style="color: ${item.item_name ? '#111827' : '#9ca3af'};">${item.item_name || 'Select Item...'}</span>
										</div>

										<!-- Batch -->
										<div 
											class="batch-field" 
											data-index="${index}" 
											tabindex="0" 
											style="padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 4px; cursor: ${item.item_code ? 'pointer' : 'not-allowed'}; background: ${item.item_code ? 'white' : '#f9fafb'}; font-size: 13px; min-height: 38px; display: flex; align-items: center;"
										>
											<span style="color: ${item.batch_no ? '#111827' : '#9ca3af'};">${item.batch_no || 'Batch...'}</span>
										</div>

										<!-- Quantity -->
										<input 
											type="number" 
											class="form-control qty-input" 
											data-index="${index}" 
											value="${item.qty}" 
											placeholder="Qty" 
											style="font-size: 13px;" 
											${!item.item_code ? 'disabled' : ''}
										>

										<!-- Rate -->
										<input 
											type="number" 
											class="form-control rate-input" 
											data-index="${index}" 
											value="${item.rate}" 
											placeholder="Rate" 
											style="font-size: 13px;" 
											${!item.item_code ? 'disabled' : ''}
										>

										<!-- Amount -->
										<input 
											type="number" 
											class="form-control amount-display" 
											data-index="${index}"
											value="${item.total_amount.toFixed(2)}" 
											placeholder="Total" 
											readonly 
											title="Base: ₹${item.amount.toFixed(2)} + Tax: ₹${item.tax_amount.toFixed(2)}"
											style="font-size: 13px; font-weight: 600; background: #f9fafb;"
										>
									</div>
								`).join('')}

								<!-- Totals -->
								<div style="border-top: 1px solid #e5e7eb; margin-top: 16px; padding-top: 16px;">
									<div style="display: flex; justify-content: flex-end;">
										<div style="text-align: right;">
											<div style="font-size: 13px; color: #6b7280; margin-bottom: 4px;">
												Subtotal: ₹<span id="subtotal">${this.calculateSubtotal().toFixed(2)}</span>
											</div>
											<div style="font-size: 13px; color: #6b7280; margin-bottom: 8px;">
												Tax (GST 18%): ₹<span id="total_tax">${this.calculateTotalTax().toFixed(2)}</span>
											</div>
											<div style="font-size: 18px; font-weight: 700; border-top: 1px solid #e5e7eb; padding-top: 8px;">
												Grand Total: ₹<span id="grand_total">${this.calculateGrandTotal().toFixed(2)}</span>
											</div>
										</div>
									</div>
								</div>
							</div>
						</div>

						<!-- Remarks -->
						<div class="mb-4">
							<label class="form-label" style="font-weight: 600; font-size: 13px; color: #374151; margin-bottom: 6px; display: block;">
								Remarks <span style="color: #2563eb; font-size: 11px;">(Press Ctrl+Enter to Save)</span>
							</label>
							<textarea 
								id="remarks" 
								class="form-control" 
								rows="3" 
								placeholder="Add any remarks or notes..."
							>${remarks}</textarea>
						</div>

						<!-- Action Buttons -->
						<div style="display: flex; gap: 12px; justify-content: flex-end; padding-top: 16px; border-top: 1px solid #e5e7eb;">
							<button 
								class="btn btn-success btn-save" 
								style="padding: 10px 32px; font-weight: 600;"
								${saving ? 'disabled' : ''}
							>
								<i class="fa fa-save"></i> ${saving ? 'Saving...' : 'Save Invoice'}
							</button>
							<button 
								class="btn btn-secondary btn-cancel" 
								style="padding: 10px 32px; font-weight: 600;"
								${saving ? 'disabled' : ''}
							>
								<i class="fa fa-times"></i> Cancel
							</button>
						</div>
					</div>
				</div>

				<!-- Custom Modals -->
				${activeModal ? this.renderModal() : ''}
			</div>
		`;
	}

	renderModal() {
		const { activeModal, searchTerm, selectedModalIndex } = this.state;
		let title = '';
		let items = [];

		if (activeModal === 'customer') {
			title = 'Select Customer';
			items = this.customers.filter(c =>
				c.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
				c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
				(c.tax_id && c.tax_id.toLowerCase().includes(searchTerm.toLowerCase()))
			);
		} else if (activeModal === 'item') {
			title = 'Select Item';
			items = this.items_list.filter(i =>
				i.item_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
				i.name.toLowerCase().includes(searchTerm.toLowerCase())
			);
		} else if (activeModal === 'batch') {
			title = 'Select Batch';
			items = this.batches.filter(b =>
				b.toLowerCase().includes(searchTerm.toLowerCase())
			);
		}

		return `
			<div class="custom-modal" style="position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1050;">
				<div style="background: white; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); width: 100%; max-width: 600px; max-height: 80vh; display: flex; flex-direction: column;">
					<!-- Modal Header -->
					<div style="display: flex; align-items: center; justify-content: space-between; padding: 16px; border-bottom: 1px solid #e5e7eb; background: #2563eb; color: white; border-radius: 8px 8px 0 0;">
						<h3 style="margin: 0; font-size: 18px; font-weight: 600;">${title}</h3>
						<button class="modal-close" style="background: none; border: none; color: white; cursor: pointer; padding: 4px 8px; font-size: 20px;">&times;</button>
					</div>

					<!-- Search Box -->
					<div style="padding: 16px; border-bottom: 1px solid #e5e7eb;">
						<div style="position: relative;">
							<i class="fa fa-search" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #9ca3af;"></i>
							<input 
								type="text" 
								id="modal_search" 
								class="form-control" 
								value="${searchTerm}" 
								placeholder="Search..."
								style="padding-left: 36px;"
								autofocus
							>
						</div>
					</div>

					<!-- Modal Content -->
					<div class="modal-items-list" style="flex: 1; overflow-y: auto; padding: 16px;">
						${items.length === 0 ? '<div style="text-align: center; color: #9ca3af; padding: 40px;">No items found</div>' :
				items.map((item, index) => {
					if (activeModal === 'customer') {
						return `
										<div class="modal-item ${index === selectedModalIndex ? 'selected' : ''}" data-index="${index}" style="padding: 12px; border: 1px solid ${index === selectedModalIndex ? '#2563eb' : '#e5e7eb'}; border-radius: 6px; margin-bottom: 8px; cursor: pointer; background: ${index === selectedModalIndex ? '#eff6ff' : 'white'}; transition: all 0.2s;">
											<div style="font-weight: 600; color: #111827;">${item.customer_name}</div>
											<div style="font-size: 11px; color: #6b7280;">${item.name}${item.tax_id ? ' | GSTIN: ' + item.tax_id : ''}</div>
										</div>
									`;
					} else if (activeModal === 'item') {
						return `
										<div class="modal-item ${index === selectedModalIndex ? 'selected' : ''}" data-index="${index}" style="padding: 12px; border: 1px solid ${index === selectedModalIndex ? '#2563eb' : '#e5e7eb'}; border-radius: 6px; margin-bottom: 8px; cursor: pointer; background: ${index === selectedModalIndex ? '#eff6ff' : 'white'}; transition: all 0.2s;">
											<div style="display: flex; justify-content: space-between;">
												<div>
													<div style="font-weight: 600; color: #111827;">${item.item_name}</div>
													<div style="font-size: 11px; color: #6b7280;">${item.name}</div>
												</div>
												<div style="text-align: right;">
													<div style="color: #2563eb; font-weight: 600;">₹${item.standard_rate || 0}</div>
													<div style="font-size: 11px; color: #6b7280;">${item.stock_uom}</div>
												</div>
											</div>
										</div>
									`;
					} else if (activeModal === 'batch') {
						return `
										<div class="modal-item ${index === selectedModalIndex ? 'selected' : ''}" data-index="${index}" style="padding: 12px; border: 1px solid ${index === selectedModalIndex ? '#2563eb' : '#e5e7eb'}; border-radius: 6px; margin-bottom: 8px; cursor: pointer; background: ${index === selectedModalIndex ? '#eff6ff' : 'white'}; transition: all 0.2s;">
											<div style="font-weight: 600; color: #111827;">${item}</div>
										</div>
									`;
					}
				}).join('')
			}
					</div>
				</div>
			</div>
		`;
	}

	attachEventListeners() {
		const container = $(this.container);

		// Invoice No - no need to prevent re-render on input
		container.find('#invoice_no').off('input keydown').on('input', (e) => {
			this.state.invoiceNo = e.target.value; // Update state without re-render
		}).on('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				container.find('#posting_date').focus();
			}
		});

		// Posting Date
		container.find('#posting_date').off('change keydown').on('change', (e) => {
			this.state.postingDate = e.target.value; // Update state without re-render
		}).on('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				container.find('#customer_field').focus();
			} else if (e.key === 'F2') {
				e.preventDefault();
				const today = frappe.datetime.get_today();
				this.state.postingDate = today;
				container.find('#posting_date').val(today);
			}
		});

		// Customer Field
		container.find('#customer_field').off('click keydown').on('click keydown', (e) => {
			if (e.type === 'keydown' && e.key !== 'Enter') return;
			e.preventDefault();
			this.setState({ activeModal: 'customer', searchTerm: '', selectedModalIndex: 0 });
		});

		// Item Fields
		container.find('.item-field').off('click keydown').on('click keydown', (e) => {
			if (e.type === 'keydown' && e.key !== 'Enter') return;
			e.preventDefault();
			const index = parseInt($(e.currentTarget).data('index'));
			this.activeLineIndex = index;
			this.setState({ activeModal: 'item', searchTerm: '', selectedModalIndex: 0 });
		});

		// Batch Fields
		container.find('.batch-field').off('click keydown').on('click keydown', (e) => {
			if (e.type === 'keydown' && e.key !== 'Enter') return;
			e.preventDefault();
			const index = parseInt($(e.currentTarget).data('index'));
			const item = this.state.items[index];
			if (item.item_code) {
				this.activeLineIndex = index;
				this.loadBatches(item.item_code);
			}
		});

		// Quantity Inputs - DON'T RE-RENDER on input, only update calculations
		container.find('.qty-input').off('input keydown').on('input', (e) => {
			const index = parseInt($(e.target).data('index'));
			this.state.items[index].qty = e.target.value;
			this.calculateLineAmount(index);
		}).on('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				const index = parseInt($(e.target).data('index'));
				container.find(`.rate-input[data-index="${index}"]`).focus();
			}
		});

		// Rate Inputs - DON'T RE-RENDER on input, only update calculations
		container.find('.rate-input').off('input keydown').on('input', (e) => {
			const index = parseInt($(e.target).data('index'));
			this.state.items[index].rate = e.target.value;
			this.calculateLineAmount(index);
		}).on('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				const index = parseInt($(e.target).data('index'));
				const item = this.state.items[index];
				if (item.item_code && item.qty && item.amount > 0) {
					this.addNewLine();
					setTimeout(() => {
						$(this.container).find('.item-row').last().find('.item-field').focus();
					}, 100);
				}
			} else if (e.key === 'Tab' && !e.shiftKey) {
				e.preventDefault();
				container.find('#remarks').focus();
			}
		});

		// Remarks
		container.find('#remarks').off('input keydown').on('input', (e) => {
			this.state.remarks = e.target.value; // Update state without re-render
		}).on('keydown', (e) => {
			if (e.ctrlKey && e.key === 'Enter') {
				e.preventDefault();
				this.saveInvoice();
			}
		});

		// Save Button
		container.find('.btn-save').off('click').on('click', () => {
			this.saveInvoice();
		});

		// Cancel Button
		container.find('.btn-cancel').off('click').on('click', () => {
			if (confirm('Are you sure you want to cancel? All unsaved data will be lost.')) {
				this.resetForm();
			}
		});

		// Modal Events
		if (this.state.activeModal) {
			// Modal close
			container.find('.modal-close').off('click').on('click', () => {
				this.setState({ activeModal: null, searchTerm: '', selectedModalIndex: 0 });
			});

			// Modal search
			container.find('#modal_search').off('input keydown').on('input', (e) => {
				this.setState({ searchTerm: e.target.value, selectedModalIndex: 0 });
			}).on('keydown', (e) => {
				this.handleModalKeyDown(e);
			}).focus();

			// Modal item clicks
			container.find('.modal-item').off('click').on('click', (e) => {
				const index = parseInt($(e.currentTarget).data('index'));
				this.handleModalItemSelect(index);
			});

			// Click outside to close
			container.find('.custom-modal').off('click').on('click', (e) => {
				if ($(e.target).hasClass('custom-modal')) {
					this.setState({ activeModal: null, searchTerm: '', selectedModalIndex: 0 });
				}
			});
		}
	}

	handleModalKeyDown(e) {
		const { activeModal, searchTerm, selectedModalIndex } = this.state;
		let items = [];

		if (activeModal === 'customer') {
			items = this.customers.filter(c =>
				c.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
				c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
				(c.tax_id && c.tax_id.toLowerCase().includes(searchTerm.toLowerCase()))
			);
		} else if (activeModal === 'item') {
			items = this.items_list.filter(i =>
				i.item_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
				i.name.toLowerCase().includes(searchTerm.toLowerCase())
			);
		} else if (activeModal === 'batch') {
			items = this.batches.filter(b =>
				b.toLowerCase().includes(searchTerm.toLowerCase())
			);
		}

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			const newIndex = Math.min(selectedModalIndex + 1, items.length - 1);
			this.setState({ selectedModalIndex: newIndex });
			this.scrollToSelected();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			const newIndex = Math.max(selectedModalIndex - 1, 0);
			this.setState({ selectedModalIndex: newIndex });
			this.scrollToSelected();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (items.length > 0) {
				this.handleModalItemSelect(selectedModalIndex);
			}
		} else if (e.key === 'Escape') {
			e.preventDefault();
			this.setState({ activeModal: null, searchTerm: '', selectedModalIndex: 0 });
		}
	}

	scrollToSelected() {
		setTimeout(() => {
			const container = $(this.container);
			const selected = container.find('.modal-item.selected')[0];
			if (selected) {
				selected.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
			}
		}, 50);
	}

	handleModalItemSelect(index) {
		const { activeModal, searchTerm } = this.state;

		if (activeModal === 'customer') {
			const filtered = this.customers.filter(c =>
				c.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
				c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
				(c.tax_id && c.tax_id.toLowerCase().includes(searchTerm.toLowerCase()))
			);
			if (filtered[index]) {
				this.setState({
					customer: filtered[index],
					activeModal: null,
					searchTerm: '',
					selectedModalIndex: 0
				});
			}
		} else if (activeModal === 'item') {
			const filtered = this.items_list.filter(i =>
				i.item_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
				i.name.toLowerCase().includes(searchTerm.toLowerCase())
			);
			if (filtered[index]) {
				const item = filtered[index];
				this.state.items[this.activeLineIndex] = {
					...this.state.items[this.activeLineIndex],
					item_code: item.name,
					item_name: item.item_name,
					rate: item.standard_rate || 0,
					uom: item.stock_uom
				};

				if (item.has_batch_no) {
					this.loadBatches(item.name);
				} else {
					this.setState({ activeModal: null, searchTerm: '', selectedModalIndex: 0 });
					setTimeout(() => {
						$(this.container).find(`.qty-input[data-index="${this.activeLineIndex}"]`).focus();
					}, 100);
				}
			}
		} else if (activeModal === 'batch') {
			const filtered = this.batches.filter(b =>
				b.toLowerCase().includes(searchTerm.toLowerCase())
			);
			if (filtered[index]) {
				this.state.items[this.activeLineIndex].batch_no = filtered[index];
				this.setState({ activeModal: null, searchTerm: '', selectedModalIndex: 0 });
				setTimeout(() => {
					$(this.container).find(`.qty-input[data-index="${this.activeLineIndex}"]`).focus();
				}, 100);
			}
		}
	}

	loadBatches(itemCode) {
		frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Batch',
				filters: {
					item: itemCode
				},
				fields: ['name'],
				limit_page_length: 0
			},
			callback: (r) => {
				if (r.message) {
					this.batches = r.message.map(b => b.name);
					this.setState({ activeModal: 'batch', searchTerm: '', selectedModalIndex: 0 });
				}
			}
		});
	}

	calculateSubtotal() {
		return this.state.items.reduce((sum, item) => sum + (item.amount || 0), 0);
	}

	calculateTotalTax() {
		return this.state.items.reduce((sum, item) => sum + (item.tax_amount || 0), 0);
	}

	calculateGrandTotal() {
		return this.calculateSubtotal() + this.calculateTotalTax();
	}

	calculateLineAmount(index) {
		const item = this.state.items[index];
		const qty = parseFloat(item.qty) || 0;
		const rate = parseFloat(item.rate) || 0;
		const amount = qty * rate;
		const taxAmount = amount * 0.18;
		const totalAmount = amount + taxAmount;

		this.state.items[index].amount = amount;
		this.state.items[index].tax_amount = taxAmount;
		this.state.items[index].total_amount = totalAmount;

		// Update only the affected line and totals, don't re-render entire form
		this.updateLineAmount(index);
	}

	addNewLine() {
		this.setState({
			items: [...this.state.items, {
				id: Date.now(),
				item_code: null,
				item_name: '',
				batch_no: null,
				qty: '',
				rate: '',
				uom: '',
				amount: 0,
				tax_amount: 0,
				total_amount: 0
			}]
		});
	}

	validateInvoice() {
		if (!this.state.customer) {
			frappe.msgprint(__('Please select a customer'));
			return false;
		}

		const validItems = this.state.items.filter(i => i.item_code && parseFloat(i.qty) > 0);
		if (validItems.length === 0) {
			frappe.msgprint(__('Please add at least one item with quantity'));
			return false;
		}

		return true;
	}

	saveInvoice() {
		if (!this.validateInvoice()) return;

		frappe.confirm(
			'Sure to save the Sales Invoice?',
			() => this.showSaveOptions()
		);
	}

	showSaveOptions() {
		const dialog = new frappe.ui.Dialog({
			title: 'Choose save option',
			fields: [{
				fieldtype: 'HTML',
				options: `
					<div style="display: flex; flex-direction: column; gap: 12px; padding: 12px 0;">
						<button class="btn btn-primary btn-block btn-save-close" style="padding: 12px; font-weight: 600;">
							<i class="fa fa-save"></i> Save & Close
						</button>
						<button class="btn btn-success btn-block btn-save-new" style="padding: 12px; font-weight: 600;">
							<i class="fa fa-plus"></i> Save & Create Another
						</button>
						<button class="btn btn-secondary btn-block" onclick="cur_dialog.hide();" style="padding: 12px; font-weight: 600;">
							Cancel
						</button>
					</div>
				`
			}]
		});

		dialog.show();

		dialog.$wrapper.find('.btn-save-close').on('click', () => {
			this.performSave().then(() => {
				dialog.hide();
				frappe.set_route('List', 'Sales Invoice');
			});
		});

		dialog.$wrapper.find('.btn-save-new').on('click', () => {
			this.performSave().then(() => {
				dialog.hide();
				this.resetForm();
			});
		});
	}

	performSave() {
		return new Promise((resolve, reject) => {
			this.setState({ saving: true });

			const validItems = this.state.items.filter(i => i.item_code && parseFloat(i.qty) > 0);

			const invoiceData = {
				doctype: 'Sales Invoice',
				customer: this.state.customer.name,
				customer_name: this.state.customer.customer_name,
				posting_date: this.state.postingDate,
				due_date: this.state.postingDate,
				items: validItems.map(i => ({
					item_code: i.item_code,
					item_name: i.item_name,
					batch_no: i.batch_no || undefined,
					qty: parseFloat(i.qty),
					rate: parseFloat(i.rate),
					amount: i.amount,
					uom: i.uom
				})),
				remarks: this.state.remarks
			};

			if (this.state.invoiceNo) {
				invoiceData.naming_series = this.state.invoiceNo;
			}

			frappe.call({
				method: 'frappe.client.insert',
				args: { doc: invoiceData },
				freeze: true,
				freeze_message: __('Saving Sales Invoice...'),
				callback: (r) => {
					if (r.message) {
						frappe.show_alert({
							message: __('Sales Invoice {0} created successfully', [r.message.name]),
							indicator: 'green'
						}, 5);
						this.setState({ saving: false });
						resolve(r.message);
					}
				},
				error: (r) => {
					frappe.msgprint(__('Error saving Sales Invoice'));
					this.setState({ saving: false });
					reject(r);
				}
			});
		});
	}

	resetForm() {
		this.setState({
			invoiceNo: '',
			postingDate: frappe.datetime.get_today(),
			customer: null,
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
			saving: false
		});
		setTimeout(() => $(this.container).find('#invoice_no').focus(), 100);
	}
}