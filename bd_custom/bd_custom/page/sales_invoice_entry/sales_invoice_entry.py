import json

import frappe
from frappe import _


@frappe.whitelist()
def get_batch_list(item_code):
	"""Fetch batches for an item from the Batch table directly."""
	return frappe.db.sql(
		"""
		SELECT
			name,
			ifnull(batch_qty, 0) as actual_qty
		FROM `tabBatch`
		WHERE item = %s
			AND disabled = 0
			AND (expiry_date >= CURDATE() OR expiry_date IS NULL)
		ORDER BY expiry_date ASC, name DESC
	""",
		(item_code,),
		as_dict=1,
	)


@frappe.whitelist()
def get_next_id(company=None):
	"""Fetch the next expected Sales Invoice ID based on the default Naming Series."""
	try:
		if not company:
			company = frappe.db.get_default("company")

		naming_series = ""

		# 1. Try to get default naming series using standard method
		from frappe.model.naming import get_default_naming_series

		naming_series = get_default_naming_series("Sales Invoice")

		# 2. If no default is set, try to find available options in DocType
		if not naming_series:
			meta = frappe.get_meta("Sales Invoice")
			if meta.get_field("naming_series"):
				options = (meta.get_field("naming_series").options or "").split("\n")
				# Filter out empty options
				options = [opt.strip() for opt in options if opt.strip()]
				if options:
					naming_series = options[0]

		if not naming_series:
			# Last resort fallback, though risky if system uses something else
			return "No Series Configured"

		# 3. Parse the naming series to get the current prefix (e.g. SINV-.YYYY.- -> SINV-2024-)
		from frappe.model.naming import parse_naming_series

		parts = naming_series.split(".")
		prefix = parse_naming_series(parts)

		# 4. Fetch the current sequence number from TabSeries
		# Use raw SQL because TabSeries is a special table and doesn't have standard columns like 'modified'
		# which frappe.db.get_value might try to use for ordering.
		count = frappe.db.sql("SELECT current FROM `tabSeries` WHERE name=%s", (prefix,))
		count = count[0][0] if count else 0

		# 5. Format the ID (Assumption: 5 digits padding is standard in ERPNext, but we can't be 100% sure without config.
		# However, 5 is a safe display guess)
		next_id = f"{prefix}{int(count) + 1:05d}"
		return next_id

	except Exception as e:
		return f"Error: {e!s}"


@frappe.whitelist()
def get_income_accounts(company=None):
	"""Fetch all leaf Income accounts."""
	if not company:
		company = frappe.db.get_default("company")

	return frappe.db.sql(
		"""
		SELECT name, account_name, parent_account
		FROM `tabAccount`
		WHERE is_group = 0
		  AND root_type = 'Income'
		  AND company = %s
		  AND disabled = 0
		ORDER BY name
	""",
		(company,),
		as_dict=1,
	)


@frappe.whitelist()
def get_items_list():
	"""Fetch items with their Standard Selling price."""
	return frappe.db.sql(
		"""
		SELECT
			i.name, i.item_name, i.stock_uom, i.has_batch_no,
			(SELECT price_list_rate FROM `tabItem Price`
			 WHERE item_code = i.name AND price_list = 'Standard Selling'
			 AND selling = 1
			 ORDER BY modified DESC LIMIT 1) as standard_rate
		FROM `tabItem` i
		WHERE i.disabled = 0 AND i.is_sales_item = 1
	""",
		as_dict=1,
	)


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
		party=customer, party_type="Customer", company=company, doctype="Sales Invoice"
	)

	# Create the real document
	new_doc = frappe.get_doc(
		{
			"doctype": "Sales Invoice",
			"customer": customer,
			"company": company,
			"posting_date": doc.get("posting_date") or frappe.utils.today(),
			"shipping_address_name": doc.get("shipping_address_name"),
			"update_stock": 1,
			"items": items,
			"remarks": doc.get("remarks"),
		}
	)

	# Apply template found in state or from defaults
	taxes_and_charges = doc.get("taxes_and_charges")
	if not taxes_and_charges:
		taxes_and_charges = party_details.get("taxes_and_charges")

	if not taxes_and_charges:
		taxes_and_charges = frappe.db.get_value(
			"Sales Taxes and Charges Template", {"company": company, "is_default": 1, "disabled": 0}, "name"
		)

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
		from erpnext.accounts.party import get_party_details
		from erpnext.controllers.accounts_controller import get_taxes_and_charges
		from erpnext.controllers.taxes_and_totals import calculate_taxes_and_totals

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
			doctype="Sales Invoice",
		)

		# Robust fallback for taxes_and_charges
		taxes_and_charges = party_details.get("taxes_and_charges")

		if not taxes_and_charges:
			# Check for default template for this company
			taxes_and_charges = frappe.db.get_value(
				"Sales Taxes and Charges Template",
				{"company": company, "is_default": 1, "disabled": 0},
				"name",
			)

		if not taxes_and_charges:
			# Pick the first available template for this company if no default is set
			taxes_and_charges = frappe.db.get_value(
				"Sales Taxes and Charges Template", {"company": company, "disabled": 0}, "name"
			)

		if taxes_and_charges:
			party_details["taxes_and_charges"] = taxes_and_charges

		# Create a temporary Sales Invoice document
		doc = frappe.get_doc(
			{
				"doctype": "Sales Invoice",
				"customer": customer,
				"company": company,
				"posting_date": posting_date or frappe.utils.today(),
				"shipping_address_name": shipping_address_name,
				"update_stock": 1,
				"items": items,
				"taxes_and_charges": taxes_and_charges,
			}
		)

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
			taxes.append({"description": tax.description, "tax_amount": tax.tax_amount, "total": tax.total})

		# Return updated item amounts for synchronization
		calculated_items = []
		for item in doc.items:
			item_tax_amount = getattr(item, "item_tax_amount", 0) or 0
			calculated_items.append(
				{
					"item_code": item.item_code,
					"amount": item.amount,
					"net_amount": item.net_amount,
					"total_amount": item.amount + item_tax_amount,
					"rate": item.rate,
				}
			)

		return {
			"taxes": taxes,
			"items": calculated_items,
			"taxes_and_charges": doc.taxes_and_charges,
			"net_total": doc.net_total,
			"total_taxes_and_charges": doc.total_taxes_and_charges,
			"grand_total": doc.grand_total,
			"rounded_total": doc.rounded_total,
			"rounding_adjustment": doc.rounding_adjustment,
		}
	except Exception as e:
		frappe.logger().error(f"calculate_invoice_taxes Error: {e!s}")
		return {"error": str(e)}


@frappe.whitelist()
def get_shipping_addresses(customer):
	"""
	Fetch shipping addresses for a customer using direct SQL for performance and reliability.
	Explicitly joins with `tabDynamic Link` to find addresses linked to the Customer.
	"""
	if not customer:
		return []

	try:
		# Base fields to fetch
		fields = [
			"`tabAddress`.name",
			"`tabAddress`.address_title",
			"`tabAddress`.address_line1",
			"`tabAddress`.address_line2",
			"`tabAddress`.city",
			"`tabAddress`.state",
			"`tabAddress`.pincode",
			"`tabAddress`.country",
			"`tabAddress`.email_id",
			"`tabAddress`.phone",
		]

		# Check for custom fields in meta
		meta = frappe.get_meta("Address")
		custom_fields = ["gstin", "gst_state", "gst_state_number"]

		for field in custom_fields:
			if meta.get_field(field):
				fields.append(f"`tabAddress`.{field}")

		# Construct the query
		fields_str = ", ".join(fields)
		query = f"""
			SELECT {fields_str}
			FROM `tabAddress`
			INNER JOIN `tabDynamic Link` ON `tabDynamic Link`.parent = `tabAddress`.name
			WHERE `tabDynamic Link`.link_doctype = 'Customer'
			  AND `tabDynamic Link`.link_name = %s
			  AND `tabAddress`.disabled = 0
			ORDER BY `tabAddress`.is_primary_address DESC, `tabAddress`.is_shipping_address DESC, `tabAddress`.name ASC
		"""

		return frappe.db.sql(query, (customer,), as_dict=1)

	except Exception as e:
		frappe.logger().error(f"Error fetching addresses: {e!s}")
		return []


@frappe.whitelist()
def get_active_customers():
	"""
	Fetch active customers from the Customer table only.
	"""
	try:
		return frappe.db.sql(
			"""
			SELECT *
			FROM `tabCustomer`
			WHERE disabled = 0
			ORDER BY name
		""",
			as_dict=1,
		)
	except Exception as e:
		frappe.logger().error(f"Error fetching customers: {e!s}")
		return []
