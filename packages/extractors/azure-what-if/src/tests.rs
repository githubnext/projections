use super::*;

const SUBNET: &str = "/subscriptions/0000/resourceGroups/rg-shop/providers/Microsoft.Network/virtualNetworks/vnet-shop/subnets/app";

#[test]
fn resource_ids_know_their_type_name_and_parent() {
    let subnet = parse_id(SUBNET).unwrap();
    assert_eq!(subnet.resource_type, "Microsoft.Network/virtualNetworks/subnets");
    assert_eq!(subnet.names, ["vnet-shop", "app"]);
    assert_eq!(
        subnet.parent.as_deref(),
        Some("/subscriptions/0000/resourcegroups/rg-shop/providers/microsoft.network/virtualnetworks/vnet-shop")
    );
    let vnet = parse_id(subnet.parent.as_deref().unwrap()).unwrap();
    assert_eq!(vnet.parent.as_deref(), Some("/subscriptions/0000/resourcegroups/rg-shop"));
    let group = parse_id("/subscriptions/0000/resourceGroups/rg-shop").unwrap();
    assert_eq!(group.resource_type, "Microsoft.Resources/resourceGroups");
    let extension = parse_id(
            "/subscriptions/0000/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm/providers/Microsoft.Insights/diagnosticSettings/logs",
        )
        .unwrap();
    assert_eq!(extension.resource_type, "Microsoft.Insights/diagnosticSettings");
    assert_eq!(
        extension.parent.as_deref(),
        Some("/subscriptions/0000/resourcegroups/rg/providers/microsoft.compute/virtualmachines/vm")
    );
    let assignment = parse_id("/subscriptions/0000/providers/Microsoft.Authorization/roleAssignments/abc").unwrap();
    assert_eq!(assignment.parent, None);
    for invalid in [
        "subnet",
        "/subscriptions/",
        "/subscriptions/0000/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks",
        "/tenants/x",
    ] {
        assert_eq!(parse_id(invalid), None, "{invalid}");
    }
}

#[test]
fn secret_named_properties_and_expressions_are_replaced() {
    let payload = json!({"adminPassword":"p","keyVaultId":"/x","primaryKey":"k","enableKey":true,
            "connectionStrings":[{"value":"s"}],"etag":"w","name":"[reference('x').name]","escaped":"[[literal]"});
    assert_eq!(
        safe(&payload),
        json!({"adminPassword":"(sensitive value)","keyVaultId":"/x","primaryKey":"(sensitive value)","enableKey":true,
                "connectionStrings":"(sensitive value)","name":"(known after deployment)","escaped":"[[literal]"})
    );
}

#[test]
fn bicep_names_and_dependencies_evaluate() {
    let template = json!({"parameters":{"vnetName":{"type":"string","defaultValue":"vnet-shop"}},"variables":{"subnet":"app"}});
    let e = Expressions { template: &template };
    assert_eq!(
        e.evaluate("[format('{0}/{1}', parameters('vnetName'), variables('subnet'))]", 0),
        Some(Evaluated::Text("vnet-shop/app".into()))
    );
    assert_eq!(
        e.evaluate(
            "[resourceId('Microsoft.Network/virtualNetworks/subnets', parameters('vnetName'), 'it''s')]",
            0
        ),
        Some(Evaluated::Resource(
            "Microsoft.Network/virtualNetworks/subnets".into(),
            "vnet-shop/it's".into()
        ))
    );
    assert_eq!(e.evaluate("[concat('a', 'b')]", 0), Some(Evaluated::Text("ab".into())));
    assert_eq!(e.evaluate("plain", 0), Some(Evaluated::Text("plain".into())));
    assert_eq!(e.evaluate("[uniqueString(resourceGroup().id)]", 0), None);
    assert_eq!(e.evaluate("[parameters('missing')]", 0), None);
}
