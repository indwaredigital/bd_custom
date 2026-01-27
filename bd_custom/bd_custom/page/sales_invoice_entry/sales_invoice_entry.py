import frappe
from frappe import _
import json


@frappe.whitelist()
def calculate_invoice_taxes(customer, items, posting_date=None, shipping_address_name=None):
	"""
	Calculate taxes and totals for a Sales Invoice without saving it.
	Returns the calculated taxes array, net_total, total_taxes_and_charges, and grand_total.
	"""
	from erpnext.controllers.taxes_and_totals import calculate_taxes_and_totals
	
	if isinstance(items, str):
		items = json.loads(items)
	
	# Create a temporary Sales Invoice document
	doc = frappe.get_doc({
		"doctype": "Sales Invoice",
		"customer": customer,
		"posting_date": posting_date or frappe.utils.today(),
		"shipping_address_name": shipping_address_name,
		"update_stock": 1,
		"items": items
	})
	
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
	
	return {
		"taxes": taxes,
		"net_total": doc.net_total,
		"total_taxes_and_charges": doc.total_taxes_and_charges,
		"grand_total": doc.grand_total
	}
