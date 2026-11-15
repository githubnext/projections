param location string = resourceGroup().location
param vnetName string = 'vnet-shop'
param vmSize string = 'Standard_D4s_v5'
@secure()
param adminPassword string

resource nsgApp 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: 'nsg-app'
  location: location
}

resource nsgEndpoints 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: 'nsg-private-endpoints'
  location: location
}

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: vnetName
  location: location
  properties: {
    addressSpace: { addressPrefixes: ['10.40.0.0/16'] }
  }
}

resource appSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: vnet
  name: 'app'
  properties: {
    addressPrefix: '10.40.1.0/24'
    networkSecurityGroup: { id: nsgApp.id }
  }
}

resource dataSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: vnet
  name: 'data'
  properties: {
    addressPrefix: '10.40.2.0/24'
    serviceEndpoints: [{ service: 'Microsoft.Storage' }]
  }
  dependsOn: [appSubnet]
}

resource pip 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: 'pip-api'
  location: location
  sku: { name: 'Standard' }
  properties: { publicIPAllocationMethod: 'Static' }
}

resource nic 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: 'nic-api'
  location: location
  properties: {
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          subnet: { id: appSubnet.id }
          publicIPAddress: { id: pip.id }
        }
      }
    ]
  }
}

resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name: 'vm-api'
  location: location
  properties: {
    hardwareProfile: { vmSize: vmSize }
    osProfile: { computerName: 'vm-api', adminUsername: 'shop', adminPassword: adminPassword }
    storageProfile: {
      imageReference: { publisher: 'Canonical', offer: 'ubuntu-24_04-lts', sku: 'server', version: 'latest' }
      osDisk: { createOption: 'FromImage' }
    }
    networkProfile: { networkInterfaces: [{ id: nic.id }] }
  }
}

resource monitor 'Microsoft.Compute/virtualMachines/extensions@2024-07-01' = {
  parent: vm
  name: 'AzureMonitorLinuxAgent'
  location: location
  properties: {
    publisher: 'Microsoft.Azure.Monitor'
    type: 'AzureMonitorLinuxAgent'
    typeHandlerVersion: '1.33'
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2024-01-01' = {
  name: 'stshopprod'
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_ZRS' }
  properties: {
    networkAcls: { defaultAction: 'Deny', virtualNetworkRules: [{ id: dataSubnet.id }] }
  }
}

resource vault 'Microsoft.KeyVault/vaults@2024-11-01' = {
  name: 'kv-shop-prod'
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    publicNetworkAccess: 'Disabled'
    networkAcls: { defaultAction: 'Deny', virtualNetworkRules: [{ id: appSubnet.id }] }
  }
}

resource endpointSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: vnet
  name: 'private-endpoints'
  properties: {
    addressPrefix: '10.40.3.0/24'
    networkSecurityGroup: { id: nsgEndpoints.id }
    privateEndpointNetworkPolicies: 'Enabled'
  }
  dependsOn: [dataSubnet]
}

resource vaultEndpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: 'pe-kv-shop-prod'
  location: location
  properties: {
    subnet: { id: endpointSubnet.id }
    privateLinkServiceConnections: [
      {
        name: 'vault'
        properties: { privateLinkServiceId: vault.id, groupIds: ['vault'] }
      }
    ]
  }
}
