import frappe
from frappe import _
import json

@frappe.whitelist()
def get_items_list():
	"""Fetch items with their Standard Selling price."""
	return frappe.db.sql("""
		SELECT 
			i.name, i.item_name, i.stock_uom, i.has_batch_no,
			(SELECT price_list_rate FROM `tabItem Price` 
			 WHERE item_code = i.name AND price_list = 'Standard Selling' 
			 AND selling = 1
			 ORDER BY modified DESC LIMIT 1) as standard_rate
		FROM `tabItem` i
		WHERE i.disabled = 0 AND i.is_sales_item = 1
	""", as_dict=1)


@frappe.whitelist()
def save_sales_invoice(doc):
	"""Save Sales Invoice with proper tax and default application."""
	if isinstance(doc, str):
		doc = json.loads(doc)
	
	# Extract items and basic info
	items = doc.get("items")
	customer = doc.get("customer")
	company = doc.get("company") or frappe.db.get_default("company")
	
	from erpnext.accounts.party import get_party_details
	from erpnext.controllers.accounts_controller import get_taxes_and_charges

	# Fetch party details to ensure we have correct defaults
	party_details = get_party_details(
		party=customer,
		party_type="Customer",
		company=company,
		doctype="Sales Invoice"
	)

	# Create the real document
	new_doc = frappe.get_doc({
		"doctype": "Sales Invoice",
		"customer": customer,
		"company": company,
		"posting_date": doc.get("posting_date") or frappe.utils.today(),
		"shipping_address_name": doc.get("shipping_address_name"),
		"update_stock": 1,
		"items": items,
		"remarks": doc.get("remarks")
	})

	# Apply template found in state or from defaults
	taxes_and_charges = doc.get("taxes_and_charges")
	if not taxes_and_charges:
		taxes_and_charges = party_details.get("taxes_and_charges")
	
	if not taxes_and_charges:
		taxes_and_charges = frappe.db.get_value("Sales Taxes and Charges Template", 
			{"company": company, "is_default": 1, "disabled": 0}, "name")

	if taxes_and_charges:
		new_doc.taxes_and_charges = taxes_and_charges
		# Manually append taxes if they don't load automatically
		taxes = get_taxes_and_charges("Sales Taxes and Charges Template", taxes_and_charges)
		if taxes:
			for tax in taxes:
				new_doc.append("taxes", tax)

	# Finalize document
	new_doc.set_missing_values()
	new_doc.calculate_taxes_and_totals()
	new_doc.insert()
	
	return new_doc.name

@frappe.whitelist()
def calculate_invoice_taxes(customer, items, posting_date=None, shipping_address_name=None, company=None):
	"""
	Calculate taxes and totals for a Sales Invoice without saving it.
	Returns the calculated taxes array, net_total, total_taxes_and_charges, and grand_total.
	"""
	try:
		from erpnext.controllers.taxes_and_totals import calculate_taxes_and_totals
		from erpnext.accounts.party import get_party_details
		from erpnext.controllers.accounts_controller import get_taxes_and_charges
		
		if isinstance(items, str):
			items = json.loads(items)
		
		if not company:
			company = frappe.db.get_default("company") or frappe.get_all("Company", limit=1, pluck="name")[0]

		# Explicitly fetch party details
		party_details = get_party_details(
			party=customer,
			party_type="Customer",
			company=company,
			posting_date=posting_date,
			shipping_address=shipping_address_name,
			doctype="Sales Invoice"
		)
		
		# Robust fallback for taxes_and_charges
		taxes_and_charges = party_details.get("taxes_and_charges")
		
		if not taxes_and_charges:
			# Check for default template for this company
			taxes_and_charges = frappe.db.get_value("Sales Taxes and Charges Template", 
				{"company": company, "is_default": 1, "disabled": 0}, "name")
		
		if not taxes_and_charges:
			# Pick the first available template for this company if no default is set
			taxes_and_charges = frappe.db.get_value("Sales Taxes and Charges Template", 
				{"company": company, "disabled": 0}, "name")
		
		if taxes_and_charges:
			party_details["taxes_and_charges"] = taxes_and_charges

		# Create a temporary Sales Invoice document
		doc = frappe.get_doc({
			"doctype": "Sales Invoice",
			"customer": customer,
			"company": company,
			"posting_date": posting_date or frappe.utils.today(),
			"shipping_address_name": shipping_address_name,
			"update_stock": 1,
			"items": items,
			"taxes_and_charges": taxes_and_charges
		})
		
		# Apply defaults from party
		doc.update(party_details)
		
		# If a template was found but taxes table is empty, fetch them manually
		if doc.taxes_and_charges and not doc.get("taxes"):
			taxes = get_taxes_and_charges("Sales Taxes and Charges Template", doc.taxes_and_charges)
			if taxes:
				for tax in taxes:
					doc.append("taxes", tax)
		
		# Fetch other missing values (like income account for items)
		doc.set_missing_values()
		
		# Run the tax calculation logic
		doc.calculate_taxes_and_totals()
		
		# Extract the calculated values
		taxes = []
		for tax in doc.get("taxes", []):
			taxes.append({
				"description": tax.description,
				"tax_amount": tax.tax_amount,
				"total": tax.total
			})
		
		# Return updated item amounts for synchronization
		calculated_items = []
		for item in doc.items:
			item_tax_amount = getattr(item, 'item_tax_amount', 0) or 0
			calculated_items.append({
				"item_code": item.item_code,
				"amount": item.amount,
				"net_amount": item.net_amount,
				"total_amount": item.amount + item_tax_amount,
				"rate": item.rate
			})
		
		return {
			"taxes": taxes,
			"items": calculated_items,
			"taxes_and_charges": doc.taxes_and_charges,
			"net_total": doc.net_total,
			"total_taxes_and_charges": doc.total_taxes_and_charges,
			"grand_total": doc.grand_total,
			"rounded_total": doc.rounded_total,
			"rounding_adjustment": doc.rounding_adjustment
		}
	except Exception as e:
		frappe.logger().error(f"calculate_invoice_taxes Error: {str(e)}")
		return {"error": str(e)}
